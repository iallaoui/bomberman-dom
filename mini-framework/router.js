export class Router {
    constructor(routes, fallback = '/') {
        this.routes = routes;
        this.fallback = fallback;
        this.handleChange = this.handleChange.bind(this);
    }

    start() {
        window.addEventListener('hashchange', this.handleChange);
        this.handleChange();
    }

    navigate(path) {
        window.location.hash = `#${path}`;
    }

    handleChange() {
        const path = window.location.hash.slice(1) || '/';
        const handler = this.routes[path];
        if (handler) handler(path);
        else this.navigate(this.fallback);
    }

    destroy() {
        window.removeEventListener('hashchange', this.handleChange);
    }
}

export default Router;
