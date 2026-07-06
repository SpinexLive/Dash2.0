import { PageHeader } from '../../components/PageHeader';

export default function TermsPage() {
  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Terms of Service"
        description="Rules for using the 331st Clan Dashboard."
      />

      <div className="card max-w-4xl space-y-6 overflow-auto p-6 text-sm leading-6 text-zinc-300">
        <section>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Last updated: 2 July 2026
          </p>
          <p className="mt-3">
            By accessing or using the 331st Clan Dashboard, you agree to these
            Terms of Service. If you do not agree, do not use the dashboard.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Access</h2>
          <p className="mt-2">
            Access is limited to authorized members and administrators of the
            community. You are responsible for actions taken through your
            Discord-authenticated account and must not attempt to access areas
            or data you are not permitted to use.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Acceptable Use</h2>
          <p className="mt-2">
            You may use the dashboard only for legitimate clan administration,
            roster planning, recruit management, briefing, and match tracking.
            Do not misuse the service, interfere with its operation, scrape it
            without permission, or use it to harass, impersonate, or harm others.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Community Data</h2>
          <p className="mt-2">
            The dashboard may display Discord profile information, roster
            assignments, recruit records, linked game identifiers, match stats,
            and related administrative notes. You must treat this information as
            community-confidential and use it only for its intended purpose.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Availability</h2>
          <p className="mt-2">
            The dashboard is provided as-is for community operations. Features
            may change, be interrupted, or be removed at any time. We are not
            liable for lost data, downtime, or decisions made from dashboard
            information.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Changes</h2>
          <p className="mt-2">
            These terms may be updated as the dashboard changes. Continued use
            after an update means you accept the revised terms.
          </p>
        </section>
      </div>
    </div>
  );
}