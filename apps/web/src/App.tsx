import { LeadForm } from './components/LeadForm';
import { ReviewQueue } from './components/ReviewQueue';
import { StatusBar } from './components/StatusBar';
import { hrefFor, navigate, useHashRoute, type Route } from './hooks/useHashRoute';
import { LeadPage } from './pages/LeadPage';

const TABS: Array<{ route: Route; label: string }> = [
  { route: { page: 'new' }, label: 'New lead' },
  { route: { page: 'queue' }, label: 'Review queue' },
];

export function App() {
  const route = useHashRoute();

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Lead Qualification Agent</h1>
          <StatusBar />
        </div>
        <nav aria-label="Main">
          {TABS.map((tab) => (
            <a
              key={tab.route.page}
              href={hrefFor(tab.route)}
              className="tab"
              aria-current={route.page === tab.route.page ? 'page' : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>

      <main>
        {route.page === 'new' && (
          <>
            <p className="intro">
              Paste an inbound lead. The agent extracts requirements, checks the company, finds
              similar past projects, scores the lead with fixed rules and drafts a reply — and sends
              anything risky to a human.
            </p>
            <LeadForm onResult={(result) => navigate({ page: 'lead', id: result.leadId })} />
          </>
        )}
        {route.page === 'queue' && <ReviewQueue />}
        {route.page === 'lead' && <LeadPage key={route.id} id={route.id} />}
      </main>
    </div>
  );
}
