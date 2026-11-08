import { h } from '../mini-framework/dom.js';

export function Join(state, send) {
    return h('main', { className: 'center-page' },
        h('section', { className: 'join-panel' },
            h('h1', {}, 'Bomberman'),
            h('p', {}, 'Enter a nickname to join the next match.'),
            h('form', {
                onSubmit: (event) => {
                    event.preventDefault();
                    const nickname = event.target.querySelector('input').value.trim();
                    if (nickname) send({ type: 'join', nickname });
                }
            },
                h('label', { htmlFor: 'nickname' }, 'Nickname'),
                h('input', { id: 'nickname', minlength: 2, maxlength: 18, autofocus: true, autocomplete: 'off' }),
                h('button', { type: 'submit', disabled: !state.connected }, state.connected ? 'Join game' : 'Connecting…')
            ),
            state.error && h('p', { className: 'error', role: 'alert' }, state.error)
        )
    );
}
