export function createStore(initialState) {
    let state = { ...initialState };
    const subscribers = new Set();

    return {
        getState: () => state,
        setState(update) {
            const changes = typeof update === 'function' ? update(state) : update;
            state = { ...state, ...changes };
            subscribers.forEach((subscriber) => subscriber(state));
        },
        subscribe(subscriber) {
            subscribers.add(subscriber);
            return () => subscribers.delete(subscriber);
        }
    };
}
