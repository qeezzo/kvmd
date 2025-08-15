"use strict";

import {tools, $} from "../tools.js";
import {checkBrowser} from "../bb.js";
import {wm, initWindowManager} from "../wm.js";

import {Session} from "./session.js";

export function main() {
    if (!checkBrowser(null, "/share/css/kvm/x-mobile.css")) return;

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

	new Session();
}
