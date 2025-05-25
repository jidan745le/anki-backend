// Example frontend code for connecting to the SSE API

// 1. First, create a chat session
async function createChatSession(messageData) {
    try {
        const response = await fetch('/api/aichat/initSession', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer YOUR_JWT_TOKEN_HERE', // Token needed for the initSession endpoint
            },
            body: JSON.stringify(messageData),
        });

        if (!response.ok) {
            throw new Error('Failed to create chat session');
        }

        const { sessionId } = await response.json();
        return sessionId;
    } catch (error) {
        console.error('Error creating chat session:', error);
        throw error;
    }
}

// 2. Connect to the SSE stream
function connectToStream(sessionId, callbacks) {
    const { onMessage, onComplete, onError } = callbacks;

    // Create EventSource connection to the stream endpoint
    // Note: No authorization header needed as this endpoint is marked @Public()
    const eventSource = new EventSource(`/api/aichat/stream/${sessionId}`);

    // Set up event listeners
    eventSource.addEventListener('message', (event) => {
        if (onMessage) {
            onMessage(event.data);
        }
    });

    eventSource.addEventListener('complete', (event) => {
        if (onComplete) {
            onComplete(JSON.parse(event.data));
        }
        // Close the connection when complete
        eventSource.close();
    });

    eventSource.onerror = (error) => {
        console.error('SSE Error:', error);
        if (onError) {
            onError(error);
        }
        eventSource.close();
    };

    return eventSource;
}

// Example usage
async function startChatWithAI() {
    const messageData = {
        cardId: 'card-uuid-here',
        chunkId: 'optional-chunk-id',
        chatcontext: 'Document', // or appropriate context type
        contextContent: 'The context of the conversation',
        chattype: 'QA',
        selectionText: 'Optional selected text',
        question: 'What is the meaning of life?',
        model: 'deepseek-chat', // or another model
    };

    try {
        // Step 1: Create a chat session
        const sessionId = await createChatSession(messageData);
        console.log('Chat session created with ID:', sessionId);

        // Prepare UI for receiving messages
        const responseContainer = document.getElementById('ai-response');
        responseContainer.innerHTML = '';

        // Step 2: Connect to the SSE stream
        const eventSource = connectToStream(sessionId, {
            onMessage: (data) => {
                // Append each chunk of text as it arrives
                responseContainer.innerHTML += data;
            },
            onComplete: (data) => {
                console.log('Stream completed:', data);
                // You might want to store the complete response or perform other actions
            },
            onError: (error) => {
                console.error('Stream error:', error);
                responseContainer.innerHTML +=
                    '<p class="error">Error: Connection lost</p>';
            },
        });

        // Optional: Provide a way to cancel the stream
        const cancelButton = document.getElementById('cancel-button');
        if (cancelButton) {
            cancelButton.onclick = () => {
                eventSource.close();
                console.log('Stream canceled by user');
            };
        }
    } catch (error) {
        console.error('Error in chat process:', error);
        // Handle error in UI
    }
}

// Call this function when the user submits a message
// startChatWithAI();
