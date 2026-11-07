export function on(type, handler) {
    return { [`on${type}`]: handler };
}

export class Events {
    constructor(root) {
        this.root = root;
        this.listeners = new Map();
        this.directListeners = [];
    }

    init(types = ['click', 'input', 'change', 'submit']) {
        for (const type of types) {
            if (this.listeners.has(type)) continue;
            const listener = (event) => {
                let element = event.target;
                while (element && this.root.contains(element)) {
                    const handler = element._handlers?.[type];
                    if (handler) {
                        handler(event);
                        return;
                    }
                    if (element === this.root) return;
                    element = element.parentElement;
                }
            };
            this.root.addEventListener(type, listener, type === 'focus' || type === 'blur');
            this.listeners.set(type, listener);
        }
    }

    listen(target, type, handler) {
        target.addEventListener(type, handler);
        this.directListeners.push({ target, type, handler });
        return handler;
    }

    destroy() {
        for (const [type, listener] of this.listeners) {
            this.root.removeEventListener(type, listener, type === 'focus' || type === 'blur');
        }
        for (const { target, type, handler } of this.directListeners) {
            target.removeEventListener(type, handler);
        }
        this.listeners.clear();
        this.directListeners = [];
    }
}
