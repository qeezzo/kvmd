"use strict";

import {tools, $} from "../tools.js";
import {checkBrowser} from "../bb.js";
import {wm, initWindowManager} from "../wm.js";

import {Session} from "./session.js";
import {Peer} from "https://esm.sh/peerjs@1.5.4?bundle-deps";

export function main() {
    if (checkBrowser(null, "/share/css/kvm/x-mobile.css")) {
        tools.storage.bindSimpleSwitch($("page-close-ask-switch"), "page.close.ask", true, function(value) {
            if (value) {
                window.onbeforeunload = function(event) {
                    let text = "Are you sure you want to close PiKVM session?";
                    if (event) {
                        event.returnValue = text;
                    }
                    return text;
                };
            } else {
                window.onbeforeunload = null;
            }
        });

        initWindowManager();

        tools.el.setOnClick($("open-log-button"), () => window.open("/api/log?seek=3600&follow=1", "_blank"));

        if (tools.config.getBool("kvm--full-tab-stream", false)) {
            wm.toggleFullTabWindow($("stream-window"), true);
        }
        wm.showWindow($("stream-window"));
				wm.showWindow($("webcam-window"));

        const remoteVideo = document.getElementById("webcam-video");

        const webcamCheckbox = document.getElementById("webcam-radio");
        const microCheckbox = document.getElementById("micro-radio");
        const webcamWindow = document.getElementById("webcam-window");
				webcamWindow.style.display = 'none';

        webcamCheckbox.addEventListener('change', () => {
            if (webcamCheckbox.checked) {
                if (confirm("Are you sure you want to enable webcamera?\nEnsure you gave Receiver ID to the Sender")) {
                    webcamWindow.style.display = 'block';
                } else {
                    webcamCheckbox.checked = false;
                }
            } else {
                webcamWindow.style.display = 'none';
            }
        });

        microCheckbox.addEventListener('change', () => {
            if (microCheckbox.checked) {
                alert("Are you sure you want to enable micro?");
								if (remoteVideo.srcObject) {
									remoteVideo.srcObject.getAudioTracks().forEach(track => track.enabled = true);
							}
            } else {
                if (remoteVideo.srcObject) {
                    remoteVideo.srcObject.getAudioTracks().forEach(track => track.enabled = false);
                }
            }
        });

        const copyButton = document.getElementById("copy-reciever-id");
		copyButton.addEventListener('click', () => {
			const receiverId = ""; // Replace this with the actual receiver ID
			navigator.mediaDevices.getUserMedia({ video: true, audio: true })
				.then(stream => {
					remoteVideo.srcObject = stream;

					const peer = new Peer(receiverId, {
						host: '10.24.0.124',
						port: '3000',
					});

					peer.on('open', id => {
						console.log(`Peer ID: ${id}`);
					});

					peer.on('call', call => {
						call.answer(stream);
						call.on('stream', remoteStream => {
							remoteVideo.srcObject = remoteStream;
						});
					});

					// If you need to call someone (not shown in your original code)
					const call = peer.call('other_peer_id', stream);
					// call.on('stream', remoteStream => {
					//     remoteVideo.srcObject = remoteStream;
					// });
					// call.on('', remoteStream => {
					//     remoteVideo.srcObject = remoteStream;
					// 	console.log('here it is')
					// });
				})
				.catch(err => {
					console.error('Failed to get local stream', err);
				});
		});

        new Session();
    }
}
