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
        node.maxChannels = parseInt(config.channel) || 1;

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        node.on('input', async function(msg) {
            // 🌟 1. LOGICA DI ACCETTAZIONE FLESSIBILE
            // Il nodo parte se il payload è 'true' OPPURE se stiamo passando una configurazione dinamica
            if (msg.payload !== true && typeof msg.payload !== 'object') return;

            node.status({fill: "blue", shape: "dot", text: "Verifica canali..."});

            // 🌟 2. VALUTAZIONE PARAMETRI DINAMICI VS PARAMETRI STATICI
            // Se le proprietà sono presenti nel msg, usiamo quelle, altrimenti facciamo il fallback su quelle del nodo
            const NVR_HOST = msg.nvr_host || node.host;
            const NVR_PORT = msg.nvr_port || node.port;
            const NVR_USER = msg.nvr_user || node.user;
            const NVR_PASS = msg.nvr_pass || node.pass;
            const NVR_NAME = msg.nvr_name || node.nodeName;
            const MAX_CHANNELS = parseInt(msg.nvr_channels) || node.maxChannels;
            const PROTOCOL = msg.nvr_protocol || node.protocol;

            const digest = new DigestAuthClass({
                username: NVR_USER, 
                password: NVR_PASS
            });
            
            const data = new Date();
            const year = data.getFullYear();
            const month = data.getMonth() + 1;
            const day = data.getDate(); 

            let snapshotResults = []; 

            // Il ciclo ora scala dinamicamente in base al numero di canali calcolato
            for (let i = 1; i <= MAX_CHANNELS; i++) {
                const chanId = i + "01";
                const snapUrl = `${PROTOCOL}://${NVR_HOST}:${NVR_PORT}/ISAPI/Streaming/channels/${chanId}/picture`;
                const recordUrl = `${PROTOCOL}://${NVR_HOST}:${NVR_PORT}/ISAPI/ContentMgmt/record/tracks/${chanId}/dailyDistribution`;
                
                const recordXml = `<?xml version="1.0" encoding="utf-8"?><trackDailyParam><year>${year}</year><monthOfYear>${month}</monthOfYear><dayOfMonth>${day}</dayOfMonth></trackDailyParam>`;

                let resCanale = {
                    name: NVR_NAME, // Dinamico o statico a seconda della modalità
                    channel: i,
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

            // Restituiamo i risultati sovrascrivendo il payload ma lasciando inalterato il resto del msg (es. msg.chatId)
            msg.payload = snapshotResults;
            node.send(msg);

            // Conteggi per lo stato visivo sul quadratino del nodo
            const snapCount = snapshotResults.filter(v => v.snapOk).length;
            const recCount = snapshotResults.filter(v => v.isRecording).length;
            
            node.status({
                fill: (snapCount === MAX_CHANNELS && recCount === MAX_CHANNELS) ? "green" : "yellow", 
                shape: "dot", 
                text: `Snap: ${snapCount}/${MAX_CHANNELS} | Rec: ${recCount}/${MAX_CHANNELS}`
            });
        });
    }
    RED.nodes.registerType("hik-snapshot", HikSnapshotNode);
};
