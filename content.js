function injectFont() {
    if (document.getElementById('curate-font-style')) return;

    try {
        const fontURL = chrome.runtime.getURL('fonts/analog-whispers.ttf');
        const style = document.createElement('style');
        style.id = 'curate-font-style';
        style.textContent = `
            @font-face {
                font-family: 'Analog Whispers';
                src: url('${fontURL}') format('truetype');
            }
        `;
        document.head.appendChild(style);
    } catch (e) {
        console.error("Curate Watchlist: Could not inject custom font.", e);
    }
}

function addQueueButton() {
    // This is the updated selector based on the HTML you provided.
    const header = document.querySelector('h1[class*="title_"]');
    if (!header || header.querySelector('.add-to-queue-btn')) return;

    const match = window.location.pathname.match(/\/label\/(\d+)/);
    if (!match || !match[1]) return;
    const labelId = match[1];

    const labelName = header.firstChild.textContent.trim();

    const button = document.createElement('button');
    button.textContent = '[add to queue >>]';
    button.className = 'add-to-queue-btn';

    Object.assign(button.style, {
        background: 'none',
        border: 'none',
        padding: '0',
        marginLeft: '15px',
        fontSize: '1.2em',
        fontFamily: '"Analog Whispers", sans-serif',
        cursor: 'pointer',
        color: '#7bd',
        verticalAlign: 'middle',
        textDecoration: 'none'
    });

    button.onmouseover = () => button.style.textDecoration = 'underline';
    button.onmouseout = () => button.style.textDecoration = 'none';

    button.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        button.textContent = '[adding...]';
        button.style.pointerEvents = 'none';

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'ADD_LABEL_TO_QUEUE',
                label: { id: labelId, name: labelName }
            });

            if (response.success) {
                button.textContent = '[added!]';
            } else {
                button.textContent = `[Error: ${response.error}]`;
            }
        } catch (error) {
            button.textContent = '[Error]';
            console.error(error);
        }

        setTimeout(() => {
            button.textContent = '[add to queue >>]';
            button.style.pointerEvents = 'auto';
        }, 2500);
    });

    header.appendChild(button);
}

function main() {
    injectFont();

    const observer = new MutationObserver(() => {
        addQueueButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    addQueueButton();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
