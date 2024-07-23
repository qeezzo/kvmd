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
        const peer = new Peer();

        peer.on('open', (id) => {
            document.getElementById("reciever-id").innerText = id;
        });

        peer.on('call', (call) => {
            call.answer();
            call.on('stream', (remoteStream) => {
                remoteVideo.srcObject = remoteStream;
                if (!document.getElementById("micro-radio").checked) {
                    remoteStream.getAudioTracks().forEach(track => track.enabled = false);
                }
            });
        });

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
            const recieverId = document.getElementById("reciever-id").innerText;
            if (recieverId) {
                navigator.clipboard.writeText(recieverId).then(() => {
                    alert("Reciever ID copied to clipboard!");
                }).catch(err => {
                    alert("Failed to copy Reciever ID: ", err);
                });
            } else {
                alert("Reciever ID is empty.");
            }
        });

        new Session();
    }
}
