import { PageHeader } from '../../components/PageHeader';

export default function PrivacyPage() {
  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Privacy Policy"
        description="How the 331st Clan Dashboard handles account and roster data."
      />

      <div className="card max-w-4xl space-y-6 overflow-auto p-6 text-sm leading-6 text-zinc-300">
        <section>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Last updated: 2 July 2026
          </p>
          <p className="mt-3">
            This Privacy Policy explains what information the 331st Clan
            Dashboard collects and how it is used for community administration.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Information We Collect</h2>
          <p className="mt-2">
            When you sign in with Discord, we may store your Discord user ID,
            username, avatar, guild membership details, roles, and authentication
            session data. Administrators may also add or view recruit records,
            roster assignments, linked Steam or Epic game IDs, match statistics,
            attendance confirmations, and dashboard settings.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">How We Use Information</h2>
          <p className="mt-2">
            Information is used to authenticate users, manage access, organize
            rosters, track recruits, display member and match stats, post roster
            updates, and support normal clan operations.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Cookies and Sessions</h2>
          <p className="mt-2">
            The dashboard uses authentication cookies or similar session storage
            to keep you signed in and protect restricted pages. Disabling cookies
            may prevent login or normal dashboard use.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Sharing</h2>
          <p className="mt-2">
            Data may be shared inside the community with authorized leaders or
            administrators. Some actions may send roster, recruit, or briefing
            information to configured Discord channels. We do not sell personal
            information.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Retention and Removal</h2>
          <p className="mt-2">
            Data is kept while it is useful for clan administration or required
            for operational records. You may ask a server administrator to review,
            correct, or remove information associated with your account where
            practical.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-100">Security</h2>
          <p className="mt-2">
            Access controls, authentication, and database permissions are used to
            protect dashboard data. No system is perfectly secure, so avoid
            entering sensitive information that is not needed for clan operations.
          </p>
        </section>
      </div>
    </div>
  );
}