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
        
        node.name = config.name || "TEST";
        node.host = config.host;
        node.port = config.port || "80";
        node.protocol = config.protocol || "http";
        node.user = config.user;
        node.pass = config.pass;
        node.camPass = config.camPass || config.pass;
        node.cameras = config.cameras || [];

        let streamRequest = null;
        let isClosing = false;
        let lastTriggerTime = {};
        let nvrOnline = true;
        let statoCamera = {}; 

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const EventList = ["FieldDetection", "LineDetection"];

        // CARTELLA TEMPORANEA 
        const baseStorage = path.join(os.tmpdir(), "hik_temp_media");
        if (!fs.existsSync(baseStorage)) fs.mkdirSync(baseStorage, { recursive: true });

        node.status({fill:"grey", shape:"ring", text:"Inizializzazione..."});

        function toHikDate(d) { return d.toISOString().split('.')[0] + "Z"; }

        // --- PRENDE IL NOME DELLA TELECAMERA ---
        async function getCameraName(cam) {
            const camAuth = new AxiosDigestAuth({ 
                username: node.user, 
                password: node.camPass 
            });

            try {
                const res = await camAuth.request({
                    method: 'GET',
                    url: `${node.protocol}://${cam.ip}:${node.port}/ISAPI/System/Video/inputs/channels/${cam.channel}/overlays/channelNameOverlay`,
                    timeout: 5000,
                    httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                });

                const data = res.data.toString();
                const match = data.match(/<name>([^<]+)<\/name>/i);
                
                if (match && match[1]) {
                    return match[1].trim();
                } else {
                    return `Canale_${cam.channel}`;
                }

            } catch (e) {
                return `Camera_${cam.channel}`; 
            }
        }

        // --- CONTROLLO STATUS CAMERE ---
        async function checkCameras() {
            if (isClosing) return;
            for (let cam of node.cameras) {
                const camAuth = new AxiosDigestAuth({ username: node.user, password: node.camPass });
                try {
                    await camAuth.request({ 
                        method: 'GET', 
                        url: `${node.protocol}://${cam.ip}:${node.port}/ISAPI/System/deviceInfo`,
                        timeout: 5000,
                        httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                    });
                    if (statoCamera[cam.ip] === false) {
                        const nomeOnline = await getCameraName(cam);
                        node.send({ payload: { tipo_messaggio: "status", stato_telecamera: "online", nome_cliente: node.name, nome_telecamera: nomeOnline, ip_telecamera: cam.ip, channel: cam.channel, msg: "Camera ripristinata" } });
                        statoCamera[cam.ip] = true;
                    } else if (statoCamera[cam.ip] === undefined) {
                        statoCamera[cam.ip] = true;
                    }
                } catch (e) {
                    if (statoCamera[cam.ip] !== false) {
                        node.send({ payload: { tipo_messaggio: "status", stato_telecamera: "offline", nome_cliente: node.name, nome_telecamera: `Camera_${cam.channel}`, ip_telecamera: cam.ip, channel: cam.channel, msg: "Camera non raggiungibile" } });
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

        // --- DOWNLOAD, SALVATAGGIO, CONVERSIONE E RIMOZIONE DOPO 2 MINUTI ---
        async function downloadMedia(evento, channelID) {
            const camera = node.cameras.find(c => c.channel == channelID);
            if (!camera) return;

            const nomeCamera = await getCameraName(camera);
            
            const nowTime = Date.now();
            if(!lastTriggerTime[camera.ip]){
                lastTriggerTime[camera.ip] = 0;
            }
            if (nowTime - lastTriggerTime[camera.ip] < 5000) return; 
            lastTriggerTime[camera.ip] = nowTime;

            const camAuth = new AxiosDigestAuth({ username: node.user, password: node.camPass });
            const referenceTime = new Date();
            const timestamp = Math.floor(referenceTime.getTime() / 1000);
            const startTime = toHikDate(new Date(referenceTime.getTime() - (10 * 1000)));
            const endTime = toHikDate(new Date(referenceTime.getTime() + (10 * 1000)));

            node.status({fill:"yellow", shape:"dot", text:`Download Cam ${channelID}...`});
            await new Promise(resolve => setTimeout(resolve, 6000));
            
            const baseUrl = `${node.protocol}://${camera.ip}:${node.port}/ISAPI/ContentMgmt`;
            
            // struttura del payload per Python
            let output = { 
                tipo_messaggio: "evento",
                nome_cliente: node.name, 
                nome_telecamera: nomeCamera, 
                ip_telecamera: camera.ip, 
                tipo_evento: evento, 
                timestamp_epoch: timestamp,
                stato_telecamera: "ONLINE",
                channel: channelID.toString(),
                foto_base64: null, 
                video_base64: null 
            };

            
            let fileDaCancellare = [];

            try {
                const tracks = [{ id: "201" }, { id: "203" }];
                for (let t of tracks) {
                    const searchXml = `<?xml version="1.0" encoding="utf-8"?><CMSearchDescription><searchID>LAST_EVENT</searchID><trackIDList><trackID>${t.id}</trackID></trackIDList><timeSpanList><timeSpan><startTime>${startTime}</startTime><endTime>${endTime}</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com/${evento}</metadataDescriptor></metadataList></CMSearchDescription>`;

                    const resSearch = await camAuth.request({ 
                        method: 'POST', url: `${baseUrl}/search`, data: searchXml, headers: { "Content-Type": "application/xml" } 
                    });
                    
                    let xml = resSearch.data.replace(/<(\/?)\w+:/g, "<$1");
                    const uriMatch = xml.match(/<playbackURI>([^<]+)</);

                    if (uriMatch) {
                        const rawUri = uriMatch[1].replace(/&amp;/g, '&');
                        const resDown = await camAuth.request({ 
                            method: 'GET',
                            url: `${baseUrl}/download`, 
                            data: `<?xml version="1.0" encoding="UTF-8"?><downloadRequest><playbackURI>${rawUri.replace(/&/g, '&amp;')}</playbackURI></downloadRequest>`, 
                            responseType: 'arraybuffer'
                        });

                        let buffer = Buffer.from(resDown.data);
                        if (t.id === "203") {
                            // SALVA FOTO IN LOCALE
                            const fullImgPath = path.join(baseStorage, `img_${timestamp}.jpg`);
                            fs.writeFileSync(fullImgPath, buffer);
                            
                            // La convertiamo subito in testo per il payload
                            output.foto_base64 = fs.readFileSync(fullImgPath, { encoding: 'base64' });
                            
                            // Registriamo il file per la distruzione futura
                            fileDaCancellare.push(fullImgPath);
                        } else {
                            // SALVA VIDEO IN LOCALE-
                            if (buffer.slice(0, 4).toString() === 'IMKH') buffer = buffer.slice(40);
                            const rawPath = path.join(baseStorage, `raw_${timestamp}.mp4`);
                            const fixedPath = path.join(baseStorage, `hik_v_${channelID}_${timestamp}.mp4`);
                            fs.writeFileSync(rawPath, buffer);
                            
                            // Eseguiamo ffmpeg localmente
                            await new Promise((resolve) => {
                                exec(`ffmpeg -y -i "${rawPath}" -c copy -movflags +faststart "${fixedPath}"`, (err) => {
                                    if (!err && fs.existsSync(fixedPath)) {
                                        output.video_base64 = fs.readFileSync(fixedPath, { encoding: 'base64' });
                                        fileDaCancellare.push(fixedPath);
                                    } else {
                                        output.video_base64 = fs.readFileSync(rawPath, { encoding: 'base64' });
                                    }
                                    fileDaCancellare.push(rawPath);
                                    resolve();
                                });
                            });
                        }
                    }
                }

                // Spediamo il pacchetto completo verso l'HTTP Request tramite Node-RED
                if (output.foto_base64 || output.video_base64) {
                    node.send({ payload: output });
                    
                    // TIMER A 2 MINUTI PER LA PULIZIA DEL DISCO 
                    setTimeout(() => {
                        for (let file of fileDaCancellare) {
                            try {
                                if (fs.existsSync(file)) {
                                    fs.unlinkSync(file);
                                }
                            } catch (err) {
                                node.error(`Errore durante la pulizia del file temporaneo ${file}: ${err.message}`);
                            }
                        }
                    }, 120000);
                }

            } catch (e) {
                node.error(`Errore Download Cam ${channelID}: ${e.message}`);
            }
            updateNodeStatus();
        }

        // --- ALERT STREAM ---
        function startAlertStream() {
            if (isClosing) return;
            const nvrAuth = new AxiosDigestAuth({ username: node.user, password: node.pass });
            const url = `${node.protocol}://${node.host}:${node.port}/ISAPI/Event/notification/alertStream`;
            nvrAuth.request({ method: 'GET', url: url, responseType: 'stream', httpsAgent: node.protocol === "https" ? httpsAgent : undefined })
            .then(response => {
                streamRequest = response;
                if (!nvrOnline) { node.send({ payload: { tipo_messaggio: "status", stato_telecamera: "online", ip: node.host, msg: "NVR Online", nome_cliente: node.name } }); nvrOnline = true; }
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
            if (nvrOnline) { node.send({ payload: { tipo_messaggio: "status", stato_telecamera: "offline", ip: node.host, msg: "NVR Offline", nome_cliente: node.name } }); nvrOnline = false; }
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
