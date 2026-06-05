## NODE-RED-CONTRIB-HIK-MEDIA-BUFFER

## HIK MEDIA BUFFER NODE

<img src='https://github.com/ALLSYSTEM-SPA/node-red-contrib-hik-media-buffer/blob/main/img/hik-media-buffer-node.png'>

The Hik Media Buffer node connects to **_NVR_** and outputs the image and the video of the event in case of alarm.</br>
This node only detects **_"FieldDetection"_** and **_"LineDetection"_** alarms but can also receive notification of a **_failed connection_** of the cameras or NVR.</br>

<img src='https://github.com/ALLSYSTEM-SPA/node-red-contrib-hik-media-buffer/blob/main/img/hik-media-buffer-configuration.png'>

To configure the node you need to enter the **_IP, user and password of the NVR_**, you can also choose the **_protocol_** and **_port_** to use.</br>
You must also enter, by pressing the **_"add"_** button, the **_channel and the correspective IP of the camera_**, finally you must enter the **_password of the cameras_**.</br>

This below is an example of msg output:</br>

```javascript
msg = {
    payload: object
    tipo_messaggio: "evento" // Type of alarm deteced (event or status)
    nome_cliente: "test" // Customer name (name of the node)
    nome_telecamera: "Ufficio" // Camera name on hiklvision
    ip_telecamera: "192.168.62.9" // IP of the camera
    tipo_evento: "LineDetection" // Type of event deteced
    timestamp_epoch: 1780645403 // Timestamp of the event 
    stato_telecamera: "ONLINE" // Status of the camera
    channel: "2" // Channel of the camera
    foto_base64: "/9j/2wCEAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSop..." // Buffer of the image base64
    video_base64: "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAABtdtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPo..." // Buffer of the image base64
    _msgid: "942a8c0c56860f42"
};

```
## HIK SNAPSHOT NODE

<img src='https://github.com/ALLSYSTEM-SPA/node-red-contrib-hik-media-buffer/blob/main/img/hik-snapshot-node.png'>

The Hik Snapshot node connects to **_NVR_** and generates a live image for each camera when it receives **_payload = true_** as input.
This node can also report if there are recordings of the day this node is triggered for each camera.

<img src='https://github.com/ALLSYSTEM-SPA/node-red-contrib-hik-media-buffer/blob/main/img/hik-snapshot-configuration.png'>

To configure the node you need to enter the **_IP, user and password of the NVR_**, you can also choose the **_protocol_** and **_port_** to use.</br>
You must also enter the number of the channels you want to get the snapshot of.</br>
If you enter "5", you will get the output of the first 5 channels on the NVR, so if you have 5 cameras on the NVR but one of them is not on the first five channels you won't get the snapshot of that camera.</br>

This below is an example of msg output:</br>

```javascript
msg = {
    payload: array[5], // 5 channels
    0: object, 
    channel: 1, // Channel 1 of the NVR
    photo: buffer[18080], // Snapshot buffer
    snapOk: true, // True if it gets the snapshot, False if not
    isRecording: true, // True if the camera recorded something that day, False if not
    1: object,
    channel: 2,
    photo: buffer[35056],
    snapOk: true,
    isRecording: true,
    2: object,
    3: object,
    4: object,
```

