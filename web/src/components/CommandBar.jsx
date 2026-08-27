import { useState } from 'react';
import { Send } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useToastStore } from '../state/toastStore';

export function CommandBar({ botId }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const push = useToastStore((state) => state.push);

  const send = async (event) => {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const response = await api.post(`/bots/${botId}/chat`, { message });
      push(
        response.data.kind === 'command' ? 'Command sent.' : 'Message sent.'
      );
      setMessage('');
    } catch (error) {
      push(errorMessage(error, 'Could not send message.'), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="flex gap-2">
      <input
        id="bot-chat-input"
        name="message"
        className="field"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Send chat or /command"
        maxLength={200}
        aria-label="Chat or command"
      />
      <button
        className="btn-primary shrink-0"
        disabled={sending || !message.trim()}
      >
        <Send size={16} /> Send
      </button>
    </form>
  );
}
