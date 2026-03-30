## NODE-RED-CONTRIB-HIK-MEDIA-BUFFER

## HIK MEDIA BUFFER NODE

<img src='https://github.com/ALLSYSTEM-SPA/node-red-contrib-hik-media-buffer/blob/main/img/hik-media-buffer-configuration.png'>

The Hik Media Buffer node connects to **_NVR_** and outputs the image and the video of the event in case of alarm.</br>
This node only detects **_"FieldDetection_** and **_"LineDetection"_** alarms but can also receive notification of a **_failed connection_** of the cameras or NVR.</br>

<img src='https://github.com/ALLSYSTEM-SPA/node-red-contrib-hik-media-buffer/blob/main/img/hik-media-buffer-node.png'>

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
    _msgid: "45fd74589048966d",
};
```
