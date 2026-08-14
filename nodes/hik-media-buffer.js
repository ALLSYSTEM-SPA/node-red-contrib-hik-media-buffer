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

        let streamRequest = null;
        let isClosing = false;
        let lastTriggerTime = {};
        let nvrOnline = true;
        let statoCamera = {}; 

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const EventList = ["FieldDetection", "LineDetection"];

        const baseStorage = path.join(os.tmpdir(), "hik_temp_media");
        if (!fs.existsSync(baseStorage)) fs.mkdirSync(baseStorage, { recursive: true });

        node.status({fill:"grey", shape:"ring", text:"Inizializzazione..."});

        // --- FORMATTAZIONE DATA LOCALE ---
        function toHikSearchDate(d) {
            const pad = (num) => String(num).padStart(2, '0');
            
            const year = d.getFullYear();
            const month = pad(d.getMonth() + 1);
            const day = pad(d.getDate());
            const hours = pad(d.getHours());
            const minutes = pad(d.getMinutes());
            const seconds = pad(d.getSeconds());
            
            return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
        }

        // --- 1. PRENDE IL NOME REALE DELLA TELECAMERA ---
        async function getCameraInfo(channelID) {
            const nvrAuth = new AxiosDigestAuth({ username: node.user, password: node.pass });
            try {
                const res = await nvrAuth.request({
                    method: 'GET',
                    url: `${node.protocol}://${node.host}:${node.port}/ISAPI/ContentMgmt/InputProxy/channels/${channelID}`,
                    timeout: 5000,
                    httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                });
                const data = res.data.toString();

                const matchName = data.match(/<name>([^<]+)<\/name>/i);
                const name = (matchName && matchName[1]) ? matchName[1].trim() : `Canale ${channelID}`;

                const matchIp = data.match(/<ipAddress>([^<]+)<\/ipAddress>/i);
                const ip_camera = (matchIp && matchIp[1]) ? matchIp[1].trim() : node.host;

                return { name, ip_camera};
            } catch (e) {
                return { nome: `Canale ${channelID}`, ipCam: node.host }; 
            }
        }

        // --- 2. CONTROLLO STATUS CAMERE AUTOMATICO ---
        async function checkCameras() {
            if (isClosing || !nvrOnline) return;
            const nvrAuth = new AxiosDigestAuth({ username: node.user, password: node.pass });
            try {
                const res = await nvrAuth.request({ 
                    method: 'GET', 
                    url: `${node.protocol}://${node.host}:${node.port}/ISAPI/ContentMgmt/InputProxy/channels/status`,
                    timeout: 8000,
                    httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                });
                
                const xml = res.data.toString();
                const channelBlocks = xml.match(/<InputProxyChannelStatus>[\s\S]*?<\/InputProxyChannelStatus>/g) || [];
                
                for (let block of channelBlocks) {
                    const idMatch = block.match(/<id>([\s\S]*?)<\/id>/i);
                    const onlineMatch = block.match(/<online>[ \t]*(true|false)[ \t]*<\/online>/i);
                    
                    if (idMatch) {
                        const ch = idMatch[1].trim();
                        const isOnline = onlineMatch ? onlineMatch[1].trim().toLowerCase() === "true" : false;

                        if (isOnline && statoCamera[ch] === false) {
                            const {name: nomeOnline, ip_camera: ip_telecamera} = await getCameraInfo(ch);
                            node.send({ payload: { tipo_messaggio: "status", stato_telecamera: "online", nome_cliente: node.name, nome_telecamera: nomeOnline, ip_telecamera: ip_telecamera, channel: ch, msg: "Camera ripristinata" } });
                            statoCamera[ch] = true;
                        } else if (!isOnline && statoCamera[ch] === true) {
                            node.send({ payload: { tipo_messaggio: "status", stato_telecamera: "offline", nome_cliente: node.name, nome_telecamera: `Camera ${ch}`, ip_telecamera: node.host, channel: ch, msg: "Camera non raggiungibile" } });
                            statoCamera[ch] = false;
                        } else if (statoCamera[ch] === undefined) {
                            statoCamera[ch] = isOnline;
                        }
                    }
                }
            } catch (e) {
                node.error(`Errore nel check diagnostico InputProxy: ${e.message}`);
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

        const heartbeatInterval = setInterval(checkCameras, 15000);

        // --- 3. DOWNLOAD MEDIA FLUIDO (Scorciatoia Diretta da JSON) ---
        async function downloadMedia(evento, channelID) {
            const nowTime = Date.now();
            if (!lastTriggerTime[channelID]) lastTriggerTime[channelID] = 0;
            if (nowTime - lastTriggerTime[channelID] < 5000) return; 
            lastTriggerTime[channelID] = nowTime;

            const nvrAuth = new AxiosDigestAuth({ username: node.user, password: node.pass });
            const referenceTime = new Date();
            const timestamp = Math.floor(referenceTime.getTime() / 1000);

            node.status({fill:"yellow", shape:"dot", text:`Attesa (15s)...`});
            await new Promise(resolve => setTimeout(resolve, 15000));

            
            const videoTrackID = (parseInt(channelID) * 100) + 1; 
            const {name: nomeCamera, ip_camera: ip_telecamera} = await getCameraInfo(channelID);
            node.status({fill:"yellow", shape:"dot", text:`Download Cam ${channelID}...`});
            
            const inizioFinestra = new Date(referenceTime.getTime() - (20 * 1000)); 
            const fineFinestra = new Date(referenceTime.getTime() + (20 * 1000));   
            
            const startFotoSearch = inizioFinestra.toISOString().split('.')[0] + "Z";
            const endFotoSearch = fineFinestra.toISOString().split('.')[0] + "Z";

            let output = { 
                tipo_messaggio: "evento",
                nome_cliente: node.name, 
                nome_telecamera: nomeCamera, 
                ip_telecamera: ip_telecamera, 
                tipo_evento: evento, 
                timestamp_epoch: timestamp,
                stato_telecamera: "ONLINE",
                channel: channelID.toString(),
                foto_base64: null, 
                video_base64: null 
            };

            let fileDaCancellare = [];

            try {

                let searchBehaviorType = "";
                if (evento) {
                    searchBehaviorType = evento.toLowerCase();
                }

                // 1. 📸 SCARICAMENTO IMMAGINE E RECUPERO METADATI ORARI
                const payloadFoto = {
                    "EventSearchDescription": {
                        "searchID": "C5AFEE35-B1E0-4C01-83F8-47FD77892E4A",
                        "searchResultPosition": 0,
                        "maxResults": 1,
                        "timeSpanList": [{ "startTime": startFotoSearch, "endTime": endFotoSearch }],
                        "type": "all",
                        "channels": [parseInt(channelID)], 
                        "eventType": "behavior",
                        "behavior": { "behaviorEventType": searchBehaviorType }
                    }
                };

                const resFotoSearch = await nvrAuth.request({
                    method: 'POST',
                    url: `${node.protocol}://${node.host}:${node.port}/ISAPI/ContentMgmt/eventRecordSearch?format=json`,
                    data: payloadFoto,
                    headers: { "Content-Type": "application/json" },
                    httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                });

                let targetEvento = resFotoSearch.data?.EventSearchResult?.Targets?.[0];
                let playbackURIGrezzo = null;

                if (targetEvento) {
                    // Scarichiamo la foto normalmente
                    if (targetEvento.pictureUrl) {
                        const urlFotoGrezzo = targetEvento.pictureUrl;
                        const resDownFoto = await nvrAuth.request({
                            method: 'GET',
                            url: urlFotoGrezzo,
                            responseType: 'arraybuffer',
                            httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                        });
                        const fullImgPath = path.join(baseStorage, `img_${timestamp}_ch${channelID}.jpg`);
                        fs.writeFileSync(fullImgPath, Buffer.from(resDownFoto.data));
                        output.foto_base64 = fs.readFileSync(fullImgPath, { encoding: 'base64' });
                        fileDaCancellare.push(fullImgPath);
                    }

                    // 2. 🎥 GENERAZIONE DINAMICA E DIRETTA PLAYBACK URI (Niente più ricerca XML!)
                    if (targetEvento.startTime && targetEvento.endTime) {
                        const pulisciDataHik = (dataStr) => {
                            let pulita = dataStr.replace(/[-:]/g, '').split('+')[0];
                            return pulita;
                        };

                        const startClip = pulisciDataHik(targetEvento.startTime);
                        const endClip = pulisciDataHik(targetEvento.endTime);

                        playbackURIGrezzo = `rtsp://${node.host}:${node.port}/Streaming/tracks/${videoTrackID}/?starttime=${startClip}&endtime=${endClip}`;
                    }
                }

                // 3. 💾 EFFETTUIAMO LA GET DI DOWNLOAD SE ABBIAMO GENERATO L'URI
                if (playbackURIGrezzo) {
                    const playbackURIXml = playbackURIGrezzo.replace(/&/g, '&amp;');

                    const payloadDownload = `<?xml version="1.0" encoding="UTF-8"?>
                    <downloadRequest>
                        <playbackURI>${playbackURIXml}</playbackURI>
                    </downloadRequest>`;

                    const resDownVideo = await nvrAuth.request({
                        method: 'GET',
                        url: `${node.protocol}://${node.host}:${node.port}/ISAPI/ContentMgmt/download`,
                        data: payloadDownload,
                        headers: { "Content-Type": "application/xml" },
                        responseType: 'stream', 
                        insecureHTTPParser: true,
                        httpsAgent: node.protocol === "https" ? httpsAgent : undefined
                    });

                    const rawPath = path.join(baseStorage, `raw_${timestamp}_ch${channelID}.mp4`);
                    const fixedPath = path.join(baseStorage, `hik_v_${channelID}_${timestamp}.mp4`);

                    const writer = fs.createWriteStream(rawPath);

                    resDownVideo.data.pipe(writer);

                    // 🌟 BLOCCO DI SICUREZZA: Aspettiamo la reale chiusura del flusso di rete dell'NVR
                    await new Promise((resolve, reject) => {
                        resDownVideo.data.on('end', () => {
                            setTimeout(() => {
                                writer.end();
                                resolve();
                            }, 500);
                        });
                        
                        resDownVideo.data.on('error', (err) => {
                            writer.end();
                            reject(err);
                        });
                        
                        writer.on('error', (err) => {
                            reject(err);
                        });
                    });

                    // Leggiamo il file finale completo per controllare la testata IMKH
                    let videoBuffer = fs.readFileSync(rawPath);
                    if (videoBuffer.slice(0, 4).toString() === 'IMKH') {
                        videoBuffer = videoBuffer.slice(40);
                        fs.writeFileSync(rawPath, videoBuffer);
                    }

                    await new Promise((resolve) => {
                        exec(`ffmpeg -y -i "${rawPath}" -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -c:a aac -movflags +faststart "${fixedPath}"`, (err) => {
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

                if (output.foto_base64 || output.video_base64) {
                    node.send({ payload: output });
                    setTimeout(() => {
                        for (let file of fileDaCancellare) {
                            try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (err) {}
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
