const axios = require('axios');
const https = require('https');
const mhocDigestSnapshot = require('@mhoc/axios-digest-auth');
const DigestAuthClass = mhocDigestSnapshot.default;

module.exports = function(RED) {
    function HikSnapshotNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.protocol = config.protocol || "http";
        node.host = config.host;
        node.port = config.port || "80";
        node.user = config.user;
        node.pass = config.pass;
        node.maxChannels = parseInt(config.channel) || 1;

        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        node.on('input', async function(msg) {
            if (msg.payload !== true) return;

            node.status({fill: "blue", shape: "dot", text: "Verifica canali..."});

            const digest = new DigestAuthClass({
                username: node.user, 
                password: node.pass
            });
            
            const data = new Date();
            const year = data.getFullYear();
            const month = data.getMonth() + 1;
            const day = data.getDate(); 

            let snapshotResults = []; 

            for (let i = 1; i <= node.maxChannels; i++) {
                const chanId = i + "01";
                const snapUrl = `${node.protocol}://${node.host}:${node.port}/ISAPI/Streaming/channels/${chanId}/picture`;
                const recordUrl = `${node.protocol}://${node.host}:${node.port}/ISAPI/ContentMgmt/record/tracks/${chanId}/dailyDistribution`;
                
                const recordXml = `<?xml version="1.0" encoding="utf-8"?><trackDailyParam><year>${year}</year><monthOfYear>${month}</monthOfYear><dayOfMonth>${day}</dayOfMonth></trackDailyParam>`;

                let resCanale = {
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
                        httpsAgent: node.protocol === 'https' ? httpsAgent : undefined,
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
                        httpsAgent: node.protocol === 'https' ? httpsAgent : undefined,
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

            msg.payload = snapshotResults;
            node.send(msg);

            // Conteggi per lo stato del nodo
            const snapCount = snapshotResults.filter(v => v.snapOk).length;
            const recCount = snapshotResults.filter(v => v.isRecording).length;
            
            node.status({
                fill: (snapCount === node.maxChannels && recCount === node.maxChannels) ? "green" : "yellow", 
                shape: "dot", 
                text: `Snap: ${snapCount}/${node.maxChannels} | Rec: ${recCount}/${node.maxChannels}`
            });
        });
    }
    RED.nodes.registerType("hik-snapshot", HikSnapshotNode);
};