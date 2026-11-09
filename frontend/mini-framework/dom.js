// A tiny virtual DOM with recursive, keyed diffing.
const previousTrees = new WeakMap();

function appendChild(children, child) {
    if (Array.isArray(child)) {
        for (const nestedChild of child) appendChild(children, nestedChild);
        return;
    }
    if (child !== null && child !== undefined && child !== false) children.push(child);
}

export function h(tag, attrs = {}, ...children) {
    const normalizedChildren = [];
    for (const child of children) appendChild(normalizedChildren, child);
    return {
        tag,
        attrs: attrs || {},
        children: normalizedChildren
    };
}

function isText(vnode) {
    return typeof vnode === 'string' || typeof vnode === 'number';
}

function createDom(vnode) {
    if (isText(vnode)) {
        return document.createTextNode(String(vnode));
    }

    const element = document.createElement(vnode.tag);
    updateAttrs(element, {}, vnode.attrs);
    for (const child of vnode.children) element.append(createDom(child));
    return element;
}

function setAttr(element, name, oldValue, value) {
    if (name === 'key') return;

    if (name.startsWith('on')) {
        const type = name.slice(2).toLowerCase();
        element._handlers ||= {};

        if (typeof value === 'function') {
            element._handlers[type] = value;
        } else {
            delete element._handlers[type];
        }
        return;
    }

    if (name === 'style') {
        const oldStyle = oldValue && typeof oldValue === 'object'
            ? oldValue : {};

        const newStyle = value && typeof value === 'object'
            ? value : {};

        for (const property of Object.keys(oldStyle)) {
            if (!(property in newStyle)) {
                element.style[property] = '';
            }
        }

        for (const [property, newValue] of Object.entries(newStyle)) {
            if (oldStyle[property] !== newValue) {
                element.style[property] = newValue;
            }
        }

        return;
    }

    if (name === 'className') {
        if (element.className !== (value || '')) {
            element.className = value || '';
        }
        return;
    }

    if (value === false || value === null || value === undefined) {
        element.removeAttribute(name);

        if (name in element) {
            if (typeof element[name] === 'boolean') {
                element[name] = false;
            } else if (typeof element[name] === 'string') {
                element[name] = '';
            }
        }
        return;
    }

    if (name in element && name !== 'list' && name !== 'form') {
        if (element[name] !== value) {
            element[name] = value;
        }
    } else {
        const attrValue = value === true ? '' : String(value);

        if (element.getAttribute(name) !== attrValue) {
            element.setAttribute(name, attrValue);
        }
    }
}

function updateAttrs(element, oldAttrs, newAttrs) {
    for (const name of Object.keys(oldAttrs)) {
        if (!(name in newAttrs)) setAttr(element, name, oldAttrs[name], undefined);
    }
    for (const name of Object.keys(newAttrs)) {
        if (oldAttrs[name] !== newAttrs[name]) {
            setAttr(element, name, oldAttrs[name], newAttrs[name]);
        }
    }
}

function keyOf(vnode) {
    return isText(vnode) ? null : vnode?.attrs?.key ?? null;
}

function sameKind(left, right) {
    if (isText(left) || isText(right)) return isText(left) && isText(right);
    return left?.tag === right?.tag;
}

function patchChildren(element, oldChildren, newChildren) {
    const oldEntries = oldChildren.map((vnode, index) => ({
        vnode,
        node: element.childNodes[index],
        used: false
    }));
    const keyedEntries = new Map(
        oldEntries.filter((entry) => keyOf(entry.vnode) !== null)
            .map((entry) => [keyOf(entry.vnode), entry])
    );

    const matches = newChildren.map((newChild) => {
        const key = keyOf(newChild);
        let entry = null;

        if (key !== null) {
            entry = keyedEntries.get(key) || null;
            if (entry?.used) entry = null;
        } else {
            entry = oldEntries.find((item) => (
                !item.used && keyOf(item.vnode) === null && sameKind(item.vnode, newChild)
            ));
        }

        if (entry) entry.used = true;
        return { entry, newChild };
    });

    // Remove stale nodes before placing survivors, so a deletion does not move
    // every following sibling just to put it ahead of the node being removed.
    for (const entry of oldEntries) {
        if (!entry.used && entry.node.parentNode === element) entry.node.remove();
    }

    for (let index = 0; index < matches.length; index += 1) {
        const { entry, newChild } = matches[index];
        const currentNode = element.childNodes[index] || null;
        if (!entry) {
            element.insertBefore(createDom(newChild), currentNode);
            continue;
        }

        if (entry.node !== currentNode) element.insertBefore(entry.node, currentNode);
        patch(element, entry.node, entry.vnode, newChild);
    }
}

function patch(parent, node, oldVNode, newVNode) {
    if (oldVNode === newVNode) return;
    if (!sameKind(oldVNode, newVNode)) {
        parent.replaceChild(createDom(newVNode), node);
        return;
    }

    if (isText(newVNode)) {
        const value = String(newVNode);
        if (node.nodeValue !== value) node.nodeValue = value;
        return;
    }

    updateAttrs(node, oldVNode.attrs, newVNode.attrs);
    patchChildren(node, oldVNode.children, newVNode.children);
}

export function render(vnode, container) {
    const hasPreviousTree = previousTrees.has(container);
    const previousTree = previousTrees.get(container);
    if (!hasPreviousTree || !container.firstChild) {
        container.replaceChildren(createDom(vnode));
    } else {
        patch(container, container.firstChild, previousTree, vnode);
    }
    previousTrees.set(container, vnode);
}
