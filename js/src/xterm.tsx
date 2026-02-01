import { IDisposable, Terminal } from "@xterm/xterm";
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { ZModemAddon } from "./zmodem";

export class GoTTYXterm {
    // The HTMLElement that contains our terminal
    elem: HTMLElement;

    // The xtermjs.XTerm
    term: Terminal;

    resizeListener: () => void;

    message: HTMLElement;
    messageTimeout: number;
    messageTimer: NodeJS.Timeout;

    onResizeHandler: IDisposable;
    onDataHandler: IDisposable;

    private ctrlActive = false;
    private altActive = false;

    fitAddOn: FitAddon;
    zmodemAddon: ZModemAddon;
    toServer: (data: string | Uint8Array) => void;
    encoder: TextEncoder

    constructor(elem: HTMLElement) {
        this.elem = elem;
        this.encoder = new TextEncoder();
        this.term = new Terminal();
        this.fitAddOn = new FitAddon();
        this.zmodemAddon = new ZModemAddon({
            toTerminal: (x: Uint8Array) => this.term.write(x),
            toServer: (x: Uint8Array) => this.sendInput(x)
        });
        this.term.loadAddon(new WebLinksAddon());
        this.term.loadAddon(this.fitAddOn);
        this.term.loadAddon(this.zmodemAddon);

        this.message = elem.ownerDocument.createElement("div");
        this.message.className = "xterm-overlay";
        this.messageTimeout = 2000;

        this.resizeListener = () => {
            this.fitAddOn.fit();
            this.term.scrollToBottom();
            this.showMessage(String(this.term.cols) + "x" + String(this.term.rows), this.messageTimeout);
        };

        this.term.open(elem);
        this.term.focus();
        this.resizeListener();

        this.createToolbar();

        window.addEventListener("resize", () => { this.resizeListener(); });
    };

    createToolbar() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
        if (!isMobile) return;

        const toolbar = document.createElement("div");
        toolbar.className = "gotty-toolbar";

        const buttons = [
            { label: "ESC", value: "\x1b" },
            { label: "Tab", value: "\t" },
            { label: "Ctrl", value: "ctrl" },
            { label: "Alt", value: "alt" },
            { label: "←", value: "\x1b[D" },
            { label: "↑", value: "\x1b[A" },
            { label: "↓", value: "\x1b[B" },
            { label: "→", value: "\x1b[C" },
        ];

        buttons.forEach(btn => {
            const button = document.createElement("button");
            button.innerHTML = btn.label;
            button.className = "gotty-toolbar-btn";
            if (btn.value === "ctrl") button.classList.add("ctrl");
            if (btn.value === "alt") button.classList.add("alt");

            button.onclick = (e) => {
                e.preventDefault();
                this.term.focus();
                if (btn.value === "ctrl") {
                    this.ctrlActive = !this.ctrlActive;
                    this.altActive = false;
                } else if (btn.value === "alt") {
                    this.altActive = !this.altActive;
                    this.ctrlActive = false;
                } else {
                    let data = btn.value;
                    if (this.toServer) {
                        this.toServer(this.encoder.encode(data));
                    }
                    this.ctrlActive = false;
                    this.altActive = false;
                }
                this.updateToolbarUI(toolbar);
            };
            toolbar.appendChild(button);
        });

        this.elem.parentNode?.appendChild(toolbar);
    }

    updateToolbarUI(toolbar: HTMLElement) {
        toolbar.querySelectorAll(".gotty-toolbar-btn").forEach(btn => {
            if (btn.classList.contains("ctrl")) {
                btn.classList.toggle("active", this.ctrlActive);
            }
            if (btn.classList.contains("alt")) {
                btn.classList.toggle("active", this.altActive);
            }
        });
    }

    info(): { columns: number, rows: number } {
        return { columns: this.term.cols, rows: this.term.rows };
    };

    // This gets called from the Websocket's onReceive handler
    output(data: Uint8Array) {
        this.zmodemAddon.consume(data);
    };

    getMessage(): HTMLElement {
        return this.message;
    }

    showMessage(message: string, timeout: number) {
        this.message.innerHTML = message;
        this.showMessageElem(timeout);
    }

    showMessageElem(timeout: number) {
        this.elem.appendChild(this.message);

        if (this.messageTimer) {
            clearTimeout(this.messageTimer);
        }
        if (timeout > 0) {
            this.messageTimer = setTimeout(() => {
                try {
                    this.elem.removeChild(this.message);
                } catch (error) {
                    console.error(error);
                }
            }, timeout);
        }
    };

    removeMessage(): void {
        if (this.message.parentNode == this.elem) {
            this.elem.removeChild(this.message);
        }
    }

    setWindowTitle(title: string) {
        document.title = title;
    };

    setPreferences(value: object) {
        Object.keys(value).forEach((key) => {
            if (key == "EnableWebGL" && key) {
                this.term.loadAddon(new WebglAddon());
            } else if (key == "font-size") {
                this.term.options.fontSize = value[key]
            } else if (key == "font-family") {
                this.term.options.fontFamily = value[key]
            }
        });
    };

    sendInput(data: Uint8Array) {
        return this.toServer(data)
    }

    onInput(callback: (input: string) => void) {
        this.encoder = new TextEncoder()
        this.toServer = callback;

        // I *think* we're ok like this, but if not, we can dispose
        // of the previous handler and put the new one in place.
        if (this.onDataHandler !== undefined) {
            return
        }

        this.onDataHandler = this.term.onData((input) => {
            let data = input;
            if (this.ctrlActive || this.altActive) {
                if (input.length === 1) {
                    const code = input.charCodeAt(0);
                    if (this.ctrlActive) {
                        if (code >= 97 && code <= 122) { // a-z
                            data = String.fromCharCode(code - 96);
                        } else if (code >= 65 && code <= 90) { // A-Z
                            data = String.fromCharCode(code - 64);
                        } else if (code === 32) { // Space
                            data = String.fromCharCode(0);
                        }
                    } else if (this.altActive) {
                        data = "\x1b" + input;
                    }
                    this.ctrlActive = false;
                    this.altActive = false;
                    const toolbar = document.querySelector(".gotty-toolbar") as HTMLElement;
                    if (toolbar) {
                        this.updateToolbarUI(toolbar);
                    }
                }
            }
            this.toServer(this.encoder.encode(data));
        });
    };

    onResize(callback: (colmuns: number, rows: number) => void) {
        this.onResizeHandler = this.term.onResize(() => {
            callback(this.term.cols, this.term.rows);
        });
    };

    deactivate(): void {
        this.onDataHandler.dispose();
        this.onResizeHandler.dispose();
        this.term.blur();
    }

    reset(): void {
        this.removeMessage();
        this.term.clear();
    }

    close(): void {
        window.removeEventListener("resize", this.resizeListener);
        this.term.dispose();
    }

    disableStdin(): void {
        this.term.options.disableStdin = true;
    }

    enableStdin(): void {
        this.term.options.disableStdin = false;
    }

    focus(): void {
        this.term.focus();
    }
}
