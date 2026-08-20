const axios = require('axios');
const https = require('https');
const mhocDigestSnapshot = require('@mhoc/axios-digest-auth');
const DigestAuthClass = mhocDigestSnapshot.default;

module.exports = function(RED) {
    function HikSnapshotNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Parametri di default salvati dalla configurazione grafica del nodo
        node.nodeName = config.name || `NVR_${config.host}`;
        node.protocol = config.protocol || "http";
        node.host = config.host;
        node.port = config.port || "80";
        node.user = config.user;
        node.pass = config.pass;
        node.channelsInput = config.channel || "1"; // Può essere "1", "1,3,5", "1-5" o numero

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        // Helper per estrarre l'array dei canali da formato stringa/numero (es: "1", "1,3,5", "1-5")
        function parseChannels(input) {
            if (!input) return [];
            const cleaned = input.toString().replace(/\s+/g, '');
            const channels = new Set();
            const parts = cleaned.split(',');

            parts.forEach(part => {
                if (part.includes('-')) {
                    const [start, end] = part.split('-').map(Number);
                    if (!isNaN(start) && !isNaN(end) && start <= end) {
                        for (let i = start; i <= end; i++) {
                            channels.add(i);
                        }
                    }
                } else {
                    const ch = Number(part);
                    if (!isNaN(ch) && ch > 0) {
                        channels.add(ch);
                    }
                }
            });

            return Array.from(channels).sort((a, b) => a - b);
        }

        node.on('input', async function(msg) {
            // 🌟 1. LOGICA DI ACCETTAZIONE FLESSIBILE
            if (msg.payload !== true && typeof msg.payload !== 'object') return;

            node.status({fill: "blue", shape: "dot", text: "Verifica canali..."});

            // 🌟 2. VALUTAZIONE PARAMETRI DINAMICI VS PARAMETRI STATICI
            const NVR_HOST = msg.nvr_host || node.host;
            const NVR_PORT = msg.nvr_port || node.port;
            const NVR_USER = msg.nvr_user || node.user;
            const NVR_PASS = msg.nvr_pass || node.pass;
            const NVR_NAME = msg.nvr_name || node.nodeName;
            const PROTOCOL = msg.nvr_protocol || node.protocol;

            // Estrazione flessibile dei canali (supporta msg.nvr_channels, msg.channel o config del nodo)
            const rawChannels = msg.nvr_channels || msg.channel || node.channelsInput;
            const targetChannels = parseChannels(rawChannels);

            const digest = new DigestAuthClass({
                username: NVR_USER, 
                password: NVR_PASS
            });
            
            const data = new Date();
            const year = data.getFullYear();
            const month = data.getMonth() + 1;
            const day = data.getDate(); 

            let snapshotResults = []; 

            // Il ciclo ora scansiona esattamente i canali definiti nell'array estratto
            for (const ch of targetChannels) {
                const chanId = ch + "01";
                const snapUrl = `${PROTOCOL}://${NVR_HOST}:${NVR_PORT}/ISAPI/Streaming/channels/${chanId}/picture`;
                const recordUrl = `${PROTOCOL}://${NVR_HOST}:${NVR_PORT}/ISAPI/ContentMgmt/record/tracks/${chanId}/dailyDistribution`;
                
                const recordXml = `<?xml version="1.0" encoding="utf-8"?><trackDailyParam><year>${year}</year><monthOfYear>${month}</monthOfYear><dayOfMonth>${day}</dayOfMonth></trackDailyParam>`;

                let resCanale = {
                    name: NVR_NAME,
                    channel: ch,
                    photo: null,
                    snapOk: false,
                    isRecording: false
                };

                // 1. SNAPSHOT
                try {
                    const responseSnap = await digest.request({
                        method: 'GET',
                        url: snapUrl,
                        responseType: 'arraybuffer',
                        httpsAgent: PROTOCOL === 'https' ? httpsAgent : undefined,
                        timeout: 5000
                    });
                    resCanale.photo = responseSnap.data;
                    resCanale.snapOk = true;
                } catch (err) {
                    resCanale.snapError = err.message;
                }

                // 2. RECORDING
                try {
                    const responseRec = await digest.request({
                        method: 'POST',
                        url: recordUrl,
                        data: recordXml,
                        headers: { 'Content-Type': 'application/xml' },
                        httpsAgent: PROTOCOL === 'https' ? httpsAgent : undefined,
                        timeout: 5000
                    });
                    const xmlOutput = responseRec.data.toString();
                    const regex = new RegExp(`<id>${day}</id>[^]*?<record>true</record>`);
                    resCanale.isRecording = regex.test(xmlOutput);
                } catch (err) {
                    resCanale.recError = err.message;
                }

                snapshotResults.push(resCanale);
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Restituiamo i risultati sovrascrivendo il payload ma lasciando inalterato il resto del msg
            msg.payload = snapshotResults;
            node.send(msg);

            // Conteggi per lo stato visivo sul quadratino del nodo
            const totalChannels = targetChannels.length;
            const snapCount = snapshotResults.filter(v => v.snapOk).length;
            const recCount = snapshotResults.filter(v => v.isRecording).length;
            
            node.status({
                fill: (snapCount === totalChannels && recCount === totalChannels && totalChannels > 0) ? "green" : "yellow", 
                shape: "dot", 
                text: `Snap: ${snapCount}/${totalChannels} | Rec: ${recCount}/${totalChannels}`
            });
        });
    }
    RED.nodes.registerType("hik-snapshot", HikSnapshotNode);
};
