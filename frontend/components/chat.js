import { h } from '../mini-framework/dom.js';

export function createChat({ send, getScreen, requestGameFocus }) {
    let cachedMessages;
    let cachedVNode;

    return function Chat(messages) {
        if (messages === cachedMessages) return cachedVNode;
        cachedMessages = messages;
        cachedVNode = h('section', { className: 'chat' },
            h('h2', {}, 'Chat'),
            h('div', { className: 'messages', 'aria-live': 'polite' },
                messages.length
                    ? messages.map((message) => h('p', { key: message.id },
                        h('strong', {}, `${message.nickname}: `), message.text
                    ))
                    : h('p', { className: 'muted' }, 'No messages yet.')
            ),
            h('form', {
                onSubmit: (event) => {
                    event.preventDefault();
                    const input = event.target.querySelector('input');
                    const text = input.value.trim();
                    if (!text) return;
                    send({ type: 'chat', text });
                    input.value = '';
                    if (getScreen() === 'game') requestGameFocus();
                }
            },
                h('input', {
                    maxlength: 180,
                    placeholder: 'Write a message',
                    'aria-label': 'Chat message',
                    onKeydown: () => {},
                    onKeyup: () => {}
                }),
                h('button', { type: 'submit' }, 'Send')
            )
        );
        return cachedVNode;
    };
}
