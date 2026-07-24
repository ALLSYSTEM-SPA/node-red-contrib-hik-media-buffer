const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const mhocDigest = require('@mhoc/axios-digest-auth');
const DigestAuthClass = mhocDigest.default;

module.exports = function(RED) {
    function HikDownloadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.protocol = config.protocol || "http";
        node.host = config.host;
        node.port = config.port || "80";
        node.user = config.user;
        node.pass = config.pass;
        node.channels = config.channels || "1";
        node.startTime = config.startTime || "";
        node.endTime = config.endTime || "";

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        function parseChannels(channelsStr) {
            let channels = [];
            if (!channelsStr) return [1];
            let parts = channelsStr.toString().split(',');
            parts.forEach(part => {
                part = part.trim();
                if (part.includes('-')) {
                    let range = part.split('-');
                    let start = parseInt(range[0]);
                    let end = parseInt(range[1]);
                    if (!isNaN(start) && !isNaN(end)) {
                        for (let i = start; i <= end; i++) channels.push(i);
                    }
                } else {
                    let ch = parseInt(part);
                    if (!isNaN(ch)) channels.push(ch);
                }
            });
            return [...new Set(channels)].sort((a, b) => a - b);
        }

        node.on('input', async function(msg) {
            if (msg.payload !== true) return;

            node.status({ fill: "blue", shape: "dot", text: "Verifica parametri..." });

            const host = msg.nvr_host || node.host;
            const port = msg.nvr_port || node.port;
            const user = msg.nvr_user || node.user;
            const pass = msg.nvr_pass || node.pass;
            const protocol = msg.nvr_protocol || node.protocol;
            const startTimeRaw = msg.startTime || node.startTime; 
            const endTimeRaw = msg.endTime || node.endTime;
            const targetChannels = parseChannels(msg.channels || node.channels);

            if (!startTimeRaw || !endTimeRaw) {
                node.status({ fill: "red", shape: "ring", text: "Date mancanti!" });
                node.error("startTime o endTime non configurati.");
                return;
            }

            // 🌟 1. FORMATTAZIONE DELLE DATE IN BASE ALLA PORTA (Bivio Logico)
            let startTimeNVR, endTimeNVR, playbackURIGrezzo, payloadDownload;
            
            const isPort85 = (port.toString() === "85");

            if (isPort85) {
                // Formato specifico DVR Porta 85: AAAA-MM-GGTHH:MM:SS (Senza Z, con trattini e due punti)
                const formattaDataDVR = (dataStr) => {
                    let d = dataStr.replace(' ', 'T').split('.')[0].replace('Z', '');
                    if (d.includes('T') && d.split('T')[1].length === 5) {
                        d += ':00';
                    }
                    return d;
                };
                startTimeNVR = formattaDataDVR(startTimeRaw);
                endTimeNVR = formattaDataDVR(endTimeRaw);

                // RTSP con porta e XML senza namespace
                const trackId = targetChannels[0] + "01"; // Default temporaneo per comporre l'URI prima del ciclo
                playbackURIGrezzo = `rtsp://${host}:${port}/Streaming/tracks/TRACK_PLACEHOLDER/?starttime=${startTimeNVR}&endtime=${endTimeNVR}`;
            } else {
                // Formato classico NVR (Senza trattini e senza due punti)
                const pulisciDataNVR = (dataStr) => {
                    let d = dataStr.replace(' ', 'T').replace(/[-:]/g, '').split('.')[0].replace('Z', '');
                    if (d.includes('T') && d.split('T')[1].length === 4) {
                        d += '00';
                    }
                    return d;
                };
                startTimeNVR = pulisciDataNVR(startTimeRaw);
                endTimeNVR = pulisciDataNVR(endTimeRaw);

                // RTSP senza porta
                playbackURIGrezzo = `rtsp://${host}/Streaming/tracks/TRACK_PLACEHOLDER/?starttime=${startTimeNVR}&endtime=${endTimeNVR}`;
            }

            // Creazione cartella di salvataggio C:\download\YYYY-MM-DD
            const dataGiorno = startTimeRaw.substring(0, 10).replace(/\//g, '-'); 
            const baseDir = process.platform === "win32" ? "C:\\download" : "/home/allsystem/download";
            const targetDir = path.join(baseDir, dataGiorno);

            try {
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "Errore cartella" });
                node.error(`Impossibile creare la cartella ${targetDir}: ${err.message}`);
                return;
            }

            const digest = new DigestAuthClass({ username: user, password: pass });

            // 🌟 2. CICLO DI DOWNLOAD
            for (let index = 0; index < targetChannels.length; index++) {
                const ch = targetChannels[index];
                const trackId = ch + "01"; 
                
                node.status({ 
                    fill: "blue", 
                    shape: "dot", 
                    text: `Download Ch ${ch} (${index + 1}/${targetChannels.length})...` 
                });

                // Sostituiamo il placeholder con la traccia corrente del ciclo
                const uriCorrente = playbackURIGrezzo.replace('TRACK_PLACEHOLDER', trackId);
                const playbackURIXml = uriCorrente.replace(/&/g, '&amp;');

                // Costruiamo l'XML a seconda del tipo di macchina
                if (isPort85) {
                    payloadDownload = `<?xml version="1.0" encoding="UTF-8"?>
                    <downloadRequest>
                        <playbackURI>${playbackURIXml}</playbackURI>
                    </downloadRequest>`;
                } else {
                    payloadDownload = `<?xml version="1.0" encoding="UTF-8"?>
                    <downloadRequest version="1.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
                        <playbackURI>${playbackURIXml}</playbackURI>
                    </downloadRequest>`;
                }

                try {
                    const response = await digest.request({
                        method: 'GET',
                        url: `${protocol}://${host}:${port}/ISAPI/ContentMgmt/download`,
                        data: payloadDownload,
                        headers: { "Content-Type": "application/xml" },
                        responseType: 'stream', 
                        insecureHTTPParser: true,
                        httpsAgent: protocol === "https" ? httpsAgent : undefined,
                        timeout: 120000 
                    });

                    if (response.status === 200 || response.status === 206) {
                        const nomeCondominio = (msg.nvr_name || node.name || 'NVR').replace(/[^a-zA-Z0-9]/g, '_');
                        const oraInizio = startTimeNVR.split('T')[1] || startTimeNVR;
                        const finalFileName = `${nomeCondominio}_Cam${ch}_${oraInizio.replace(/:/g, '')}.mp4`;
                        const finalFilePath = path.join(targetDir, finalFileName);

                        const writer = fs.createWriteStream(finalFilePath);
                        const videoChunks = [];

                        // Ascoltiamo i dati in arrivo dallo stream per salvarli anche in memoria
                        response.data.on('data', (chunk) => {
                            videoChunks.push(chunk);
                        });

                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', (err) => {
                                writer.close();
                                reject(err);
                            });
                        });

                        node.log(`File salvato in: ${finalFilePath}`);

                        const videoBuffer = Buffer.concat(videoChunks);

                        let outMsg = RED.util.cloneMessage(msg);
                        outMsg.payload = videoBuffer;
                        outMsg.localFilePath = finalFilePath;
                        outMsg.channel = ch;
                        outMsg.filename = finalFileName;
                        node.send(outMsg);
                    } else {
                        node.error(`Errore NVR Ch ${ch} Status: ${response.status}`);
                    }

                } catch (err) {
                    node.error(`Errore download video Cam ${ch}: ${err.message}`);
                }

                if (targetChannels.length > 1 && index < targetChannels.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            node.status({ fill: "green", shape: "dot", text: `Salvati in C:\\download\\${dataGiorno}` });
        });
    }
    RED.nodes.registerType("hik-download", HikDownloadNode);
};
