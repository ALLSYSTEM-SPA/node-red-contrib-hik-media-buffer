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
    payload: object,
    ip: "192.168.62.9", // IP of the camera
    channel: "2", // Channel of the camera
    event: "LineDetection", // Type of event deteced 
    videoPath: "C:\Users\APerucca\AppData\Local\Temp\hik_v_2_1774874791241.mp4", // Path of the video
    imageBuffer: buffer[12360], // Buffer of the image
    status: "online", // Status of the camera
    _msgid: "45fd74589048966d",
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
    isRecording: true, // True if it the camera recorded something that day, False if not
    1: object,
    channel: 2,
    photo: buffer[35056],
    snapOk: true,
    isRecording: true,
    2: object,
    3: object,
    4: object,
```

