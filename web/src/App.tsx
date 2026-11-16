import * as Tooltip from '@radix-ui/react-tooltip';
import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { Logo } from './components/Logo';
import { Shell } from './components/Shell';
import { match, navigate, usePath } from './lib/router';
import { connectEvents, disconnectEvents, useStore } from './lib/store';
import { ActivityView } from './views/Activity';
import { AuthScreen } from './views/Auth';
import { ChatHome, ChatView } from './views/Chat';
import { GoalsView, RoutinesView } from './views/Goals';
import { InboxView } from './views/Inbox';
import { MemoryView } from './views/Memory';
import { SettingsView } from './views/Settings';
import { SpaceView, SpacesList } from './views/Spaces';
import { WatchersView } from './views/Watchers';
import { WebhooksView } from './views/Webhooks';

function Routes() {
  const path = usePath();
  let m: Record<string, string> | null;
  if ((m = match('/chat/:id', path))) return { key: `chat-${m.id}`, el: <ChatView id={m.id} /> };
  if (path === '/goals') return { key: 'goals', el: <GoalsView /> };
  if (path === '/watchers') return { key: 'watchers', el: <WatchersView /> };
  if (path === '/webhooks') return { key: 'webhooks', el: <WebhooksView /> };
  if (path === '/routines') return { key: 'routines', el: <RoutinesView /> };
  if (path === '/spaces') return { key: 'spaces', el: <SpacesList /> };
  if ((m = match('/spaces/:id', path))) return { key: `space-${m.id}`, el: <SpaceView id={m.id} /> };
  if (path === '/inbox') return { key: 'inbox', el: <InboxView /> };
  if (path === '/activity') return { key: 'activity', el: <ActivityView /> };
  if (path === '/memory') return { key: 'memory', el: <MemoryView /> };
  if (path === '/settings' || (m = match('/settings/:section', path))) return { key: 'settings', el: <SettingsView section={m?.section} /> };
  return { key: 'home', el: <ChatHome /> };
}

export function App() {
  const auth = useStore((s) => s.auth);
  const boot = useStore((s) => s.boot);
  const path = usePath();

  useEffect(() => {
    boot().catch(() => useStore.setState({ auth: 'login' }));
    const onUnauthorized = () => {
      disconnectEvents();
      useStore.setState({ auth: 'login' });
    };
    window.addEventListener('sable:unauthorized', onUnauthorized);
    // Notification clicks from the service worker.
    const onSwMessage = (e: MessageEvent) => e.data?.type === 'navigate' && navigate(e.data.link);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => {
      window.removeEventListener('sable:unauthorized', onUnauthorized);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [boot]);

  useEffect(() => {
    if (auth === 'ready') connectEvents();
  }, [auth]);

  const route = Routes();
  void path;

  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
      {auth === 'loading' && (
        <div className="flex h-dvh items-center justify-center bg-bg">
          <Logo size={28} className="animate-pulse" />
        </div>
      )}
      {(auth === 'setup' || auth === 'login') && <AuthScreen mode={auth} />}
      {auth === 'ready' && <Shell routeKey={route.key}>{route.el}</Shell>}
      </Tooltip.Provider>
    </MotionConfig>
  );
}
