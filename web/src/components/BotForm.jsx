import { useEffect } from 'react';
import { Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { api, errorMessage } from '../lib/api';
import { useToastStore } from '../state/toastStore';
import { useDashboardStore } from '../state/dashboardStore';

const emptyValues = {
  label: '',
  host: '',
  port: 25565,
  username: '',
  version: '1.20.4',
  password: '',
  autoReconnect: true,
};

export function BotForm({ bot, onSaved }) {
  const push = useToastStore((state) => state.push);
  const upsertBot = useDashboardStore((state) => state.upsertBot);
  const isEdit = Boolean(bot);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: bot ? { ...bot, password: '' } : emptyValues });

  useEffect(() => {
    reset(bot ? { ...bot, password: '' } : emptyValues);
  }, [bot, reset]);

  const submit = async (values) => {
    const payload = { ...values, port: Number(values.port) };
    try {
      const response = isEdit
        ? await api.patch(`/bots/${bot.id}`, payload)
        : await api.post('/bots', payload);
      upsertBot(response.data.bot);
      push(
        isEdit
          ? 'Configuration saved.'
          : 'Bot created. It is stopped by default.'
      );
      onSaved?.(response.data.bot);
    } catch (error) {
      push(errorMessage(error, 'Could not save bot.'), 'error');
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      {isEdit && bot.state !== 'OFFLINE' && (
        <div className="border-l-2 border-status-pending bg-amber-950/30 px-3 py-2 text-sm text-status-pending">
          The bot is running. Restart is required for connection changes to take
          effect.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display label" error={errors.label?.message}>
          <input
            id="bot-label"
            className="field"
            {...register('label', {
              required: 'Label is required.',
              maxLength: { value: 80, message: 'Maximum 80 characters.' },
            })}
          />
        </Field>
        <Field label="Minecraft username" error={errors.username?.message}>
          <input
            id="bot-username"
            className="field"
            {...register('username', {
              required: 'Username is required.',
              minLength: { value: 3, message: 'Minimum 3 characters.' },
              maxLength: { value: 16, message: 'Maximum 16 characters.' },
            })}
          />
        </Field>
        <Field label="Server host" error={errors.host?.message}>
          <input
            id="bot-host"
            className="field"
            {...register('host', { required: 'Host is required.' })}
          />
        </Field>
        <Field label="Port" error={errors.port?.message}>
          <input
            id="bot-port"
            type="number"
            className="field"
            {...register('port', {
              required: true,
              min: { value: 1, message: 'Minimum 1.' },
              max: { value: 65535, message: 'Maximum 65535.' },
            })}
          />
        </Field>
        <Field label="Minecraft version" error={errors.version?.message}>
          <input
            id="bot-version"
            className="field"
            {...register('version', { required: 'Version is required.' })}
          />
        </Field>
        <Field
          label="AuthMe password"
          hint={isEdit ? 'Leave blank to clear the password.' : 'Optional'}
        >
          <input
            id="bot-password"
            type="password"
            autoComplete="new-password"
            className="field"
            {...register('password')}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          id="bot-auto-reconnect"
          type="checkbox"
          className="h-4 w-4 accent-accent"
          {...register('autoReconnect')}
        />{' '}
        Auto-reconnect
      </label>
      <button className="btn-primary" type="submit" disabled={isSubmitting}>
        <Save size={16} />
        {isSubmitting
          ? 'Saving…'
          : isEdit
            ? 'Save configuration'
            : 'Create bot'}
      </button>
    </form>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error && (
        <span className="mt-1 block text-xs text-status-error">{error}</span>
      )}
      {hint && !error && (
        <span className="mt-1 block text-xs text-text-secondary">{hint}</span>
      )}
    </label>
  );
}
