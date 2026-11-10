import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DeveloperLayout, type DeveloperTab } from '../components/developer/DeveloperLayout.tsx';
import { DeveloperOverview } from '../components/developer/panels/Overview.tsx';
import { DeveloperUsers } from '../components/developer/panels/Users.tsx';
import { DeveloperAnalytics } from '../components/developer/panels/Analytics.tsx';
import { DeveloperAi } from '../components/developer/panels/Ai.tsx';
import { DeveloperNotifications } from '../components/developer/panels/Notifications.tsx';
import { DeveloperAds } from '../components/developer/panels/Ads.tsx';
import { DeveloperTools } from '../components/developer/panels/Tools.tsx';
import { DeveloperHealth } from '../components/developer/panels/Health.tsx';
import { DeveloperActivity } from '../components/developer/panels/Activity.tsx';
import { DeveloperFeedback } from '../components/developer/panels/Feedback.tsx';
import { DeveloperSettings } from '../components/developer/panels/Settings.tsx';
import { api, ApiError } from '../lib/api.ts';
import type { DeveloperContext, RangeKey } from '../lib/developerTypes.ts';
import { LoadingBlock } from '../components/developer/ui.tsx';
import '../developer.css';

const tabKeys: DeveloperTab[] = [
  'overview',
  'users',
  'analytics',
  'ai',
  'notifications',
  'ads',
  'tools',
  'health',
  'activity',
  'feedback',
  'settings',
];

function asTab(value: string | null): DeveloperTab {
  return tabKeys.includes(value as DeveloperTab) ? (value as DeveloperTab) : 'overview';
}

export default function DeveloperPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = asTab(searchParams.get('tab'));
  const [range, setRange] = useState<RangeKey>('7d');
  const [context, setContext] = useState<DeveloperContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadContext = useCallback(async () => {
    try {
      const data = await api.get<DeveloperContext>('/developer/context');
      setContext(data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل سياق لوحة المطوّر.');
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
    void loadContext().finally(() => setRefreshing(false));
  }, [loadContext]);

  const setTab = (next: DeveloperTab) => {
    setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <DeveloperLayout
      active={tab}
      context={context}
      range={range}
      onRange={setRange}
      onTab={setTab}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      {error && <div className="dev-alert">{error}</div>}
      {!context && !error ? (
        <LoadingBlock label="جار التحقق من صلاحية المطوّر وتحميل الملخص…" />
      ) : (
        <div key={`${tab}-${refreshKey}`}>
          {tab === 'overview' && (
            <DeveloperOverview range={range} onNavigate={setTab} onRefreshContext={loadContext} />
          )}
          {tab === 'users' && <DeveloperUsers onError={setError} onNotice={() => loadContext()} />}
          {tab === 'analytics' && <DeveloperAnalytics range={range} />}
          {tab === 'ai' && <DeveloperAi range={range} onRefreshContext={loadContext} />}
          {tab === 'notifications' && (
            <DeveloperNotifications onNotice={() => loadContext()} />
          )}
          {tab === 'ads' && <DeveloperAds />}
          {tab === 'tools' && <DeveloperTools onRefreshContext={loadContext} />}
          {tab === 'health' && <DeveloperHealth />}
          {tab === 'activity' && <DeveloperActivity range={range} />}
          {tab === 'feedback' && <DeveloperFeedback onRefreshContext={loadContext} />}
          {tab === 'settings' && <DeveloperSettings onRefreshContext={loadContext} />}
        </div>
      )}
    </DeveloperLayout>
  );
}
