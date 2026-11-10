import { h } from '../mini-framework/dom.js';

export function createChat({ send }) {
    let previousMessages;
    let cachedChat;
    return function Chat(messages) {
        if (messages === previousMessages) return cachedChat;
        previousMessages = messages;
        cachedChat = h('section', { className: 'chat' },
            h('h2', {}, 'Chat'),
            h('div', { className: 'messages', 'aria-live': 'polite' },
                messages.length
                    ? messages.map((message) => message.system
                        ? h('p', { key: message.id, className: 'system-message' }, message.text)
                        : h('p', { key: message.id },
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
                }
            },
                h('input', {
                    maxlength: 180,
                    placeholder: 'Write a message',
                    'aria-label': 'Chat message'
                }),
                h('button', { type: 'submit' }, 'Send')
            )
        );
        return cachedChat;
    };
}
