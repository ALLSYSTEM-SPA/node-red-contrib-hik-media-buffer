const axios = require('axios');
const AxiosDigestAuth = require('@mhoc/axios-digest-auth').default;
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

module.exports = function(RED) {
    function HikMediaBufferNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // --- ASSEGNAZIONE PROPRIETÀ AL NODO ---
        node.host = config.host;
        node.port = config.port || "80";
        node.protocol = config.protocol || "http";
        node.user = config.user;
        node.pass = config.pass;
        node.camPass = config.camPass || config.pass; // Usa pass dell'NVR se quella cam specifica non c'è
        node.cameras = config.cameras || [];
        // --------------------------------------

        let streamRequest = null;
        let isClosing = false;
        let lastTriggerTime = 0;
        
        // Stati di connessione
        let nvrOnline = true;
        let statoCamera = {}; // Memorizza lo stato { "IP": true/false }

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const tempDir = os.tmpdir();
        const EventList = ["FieldDetection", "LineDetection"];

        node.status({fill:"grey", shape:"ring", text:"Inizializzazione..."});

        function toHikDate(d) { return d.toISOString().split('.')[0] + "Z"; }
   
        // --- CONTROLLO SE LE TELECAMERE SONO ONLINE ---
        async function checkCameras() {
            if (isClosing) return;
            for (let cam of node.cameras) {
                const camAuth = new AxiosDigestAuth({ 
                    username: node.user, 
                    password: node.camPass 
                });
                try {
                    await camAuth.request({ 
                        method: 'GET', 
                        url: `${node.protocol}://${cam.ip}:${node.port}/ISAPI/System/deviceInfo`,
                        timeout: 5000,
                        httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                    });

                    if (statoCamera[cam.ip] === false) {
                        node.send({ payload: { status: "online", ip: cam.ip, channel: cam.channel, msg: "Camera ripristinata" } });
                        statoCamera[cam.ip] = true;
                    } else if (statoCamera[cam.ip] === undefined) {
                        statoCamera[cam.ip] = true;
                    }
                } catch (e) {
                    if (statoCamera[cam.ip] !== false) {
                        node.send({ payload: { status: "offline", ip: cam.ip, channel: cam.channel, msg: "Camera non raggiungibile" } });
                        statoCamera[cam.ip] = false;
                    }
                }
            }
            updateNodeStatus();
        }

        function updateNodeStatus() {
            const offlineCams = Object.values(statoCamera).filter(v => v === false).length;
            if (!nvrOnline) {
                node.status({fill:"red", shape:"ring", text:"NVR Offline"});
            } else if (offlineCams > 0) {
                node.status({fill:"yellow", shape:"dot", text: `${offlineCams} Cam Offline`});
            } else {
                node.status({fill:"green", shape:"ring", text:"In ascolto"});
            }
        }

        const heartbeatInterval = setInterval(checkCameras, 30000);

        // --- FUNZIONE DOWNLOAD ---
        async function downloadMedia(evento, channelID) {
            const camera = node.cameras.find(c => c.channel == channelID);
            if (!camera) return;

            const nowTime = Date.now();
            if (nowTime - lastTriggerTime < 10000) return; 
            lastTriggerTime = nowTime;

            const camAuth = new AxiosDigestAuth({ 
                username: node.user, 
                password: node.camPass 
            });
            const referenceTime = new Date();
            const startTime = toHikDate(new Date(referenceTime.getTime() - (10 * 1000)));
            const endTime = toHikDate(new Date(referenceTime.getTime() + (10 * 1000)));

            node.status({fill:"yellow", shape:"dot", text:`Download Cam ${channelID}...`});
            await new Promise(resolve => setTimeout(resolve, 6000));
            
            const baseUrl = `${node.protocol}://${camera.ip}:${node.port}/ISAPI/ContentMgmt`;
            let output = { ip: camera.ip, channel: channelID, event: evento, videoPath: null, imageBuffer: null };

            try {
                const tracks = [{ name: "termicoV", id: "201" }, { name: "termico", id: "203" }];
                for (let t of tracks) {
                    const searchXml = `<?xml version="1.0" encoding="utf-8"?>
<CMSearchDescription>
    <searchID>LAST_EVENT</searchID>
    <trackIDList><trackID>${t.id}</trackID></trackIDList>
    <timeSpanList><timeSpan><startTime>${startTime}</startTime><endTime>${endTime}</endTime></timeSpan></timeSpanList>
    <maxResults>100</maxResults>
    <searchResultPostion>0</searchResultPostion>
    <metadataList><metadataDescriptor>//recordType.meta.std-cgi.com/${evento}</metadataDescriptor></metadataList>
</CMSearchDescription>`;

                    const resSearch = await camAuth.request({ 
                        method: 'POST',
                        url: `${baseUrl}/search`, 
                        data: searchXml, 
                        headers: { "Content-Type": "application/xml" } 
                    });
                    
                    let xml = resSearch.data.replace(/<(\/?)\w+:/g, "<$1");
                    const uriMatch = xml.match(/<playbackURI>([^<]+)</);

                    if (uriMatch) {
                        const rawUri = uriMatch[1].replace(/&amp;/g, '&');
                        const resDown = await camAuth.request({ 
                            method: 'GET', url: `${baseUrl}/download`, 
                            data: `<?xml version="1.0" encoding="UTF-8"?><downloadRequest><playbackURI>${rawUri.replace(/&/g, '&amp;')}</playbackURI></downloadRequest>`, 
                            responseType: 'arraybuffer'
                        });

                        let buffer = Buffer.from(resDown.data);
                        if (t.id === "203") {
                            output.imageBuffer = buffer;
                        } else {
                            if (buffer.slice(0, 4).toString() === 'IMKH') buffer = buffer.slice(40);
                            const rawPath = path.join(tempDir, `raw_${Date.now()}.mp4`);
                            const fixedPath = path.join(tempDir, `hik_v_${channelID}_${Date.now()}.mp4`);
                            fs.writeFileSync(rawPath, buffer);
                            await new Promise((resolve) => {
                                exec(`ffmpeg -y -i "${rawPath}" -c copy -movflags +faststart "${fixedPath}"`, (err) => {
                                    if (!err) {
                                        output.videoPath = fixedPath;
                                        try { fs.unlinkSync(rawPath); } catch(e) {}
                                    } else { output.videoPath = rawPath; }
                                    resolve();
                                });
                            });
                            setTimeout(() => { if (output.videoPath && fs.existsSync(output.videoPath)) fs.unlinkSync(output.videoPath); }, 180000);
                        }
                    }
                }
                if (output.imageBuffer || output.videoPath) node.send({ payload: output });
            } catch (e) {
                node.error(`Errore Download Cam ${channelID}: ${e.message}`);
            }
            updateNodeStatus();
        }

        // --- GESTIONE NVR ALERT STREAM ---
        function startAlertStream() {
            if (isClosing) return;
            const nvrAuth = new AxiosDigestAuth({ 
                username: node.user, 
                password: node.pass 
            });
            const url = `${node.protocol}://${node.host}:${node.port}/ISAPI/Event/notification/alertStream`;
            
            nvrAuth.request({ 
                method: 'GET', url: url, responseType: 'stream', 
                httpsAgent: node.protocol === "https" ? httpsAgent : undefined
            }).then(response => {
                streamRequest = response;
                if (!nvrOnline) {
                    node.send({ payload: { status: "online", ip: node.host, msg: "NVR Online" } });
                    nvrOnline = true;
                }
                updateNodeStatus();

                response.data.on('data', (chunk) => {
                    const data = chunk.toString().toLowerCase();
                    if (data.includes("active")) {
                        const chMatch = data.match(/<channelid>(\d+)<\/channelid>/i);
                        if (chMatch) {
                            let ev = "Unknown";
                            for (let e of EventList) { if (data.includes(e.toLowerCase())) { ev = e; break; } }
                            downloadMedia(ev, chMatch[1]);
                        }
                    }
                });

                response.data.on('error', () => handleNvrError());
                response.data.on('end', () => !isClosing && setTimeout(startAlertStream, 5000));
            }).catch(() => handleNvrError());
        }

        function handleNvrError() {
            if (nvrOnline) {
                node.send({ payload: { status: "offline", ip: node.host, msg: "NVR Offline" } });
                nvrOnline = false;
            }
            updateNodeStatus();
            if (!isClosing) setTimeout(startAlertStream, 10000);
        }

        startAlertStream();
        setTimeout(checkCameras, 2000); 

        node.on('close', (done) => { 
            isClosing = true; 
            clearInterval(heartbeatInterval);
            if (streamRequest) streamRequest.data.destroy(); 
            done(); 
        });
    }
    RED.nodes.registerType("hik-media-buffer", HikMediaBufferNode);
};