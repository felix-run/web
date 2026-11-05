/**
 * `/harness/connections`: the services you have connected, so an agent can act as you there.
 *
 * What can be connected is the deployment's, so it comes from `GET /connections/providers` and a
 * method this client does not know is left out. A harness older than that route answers 404, and
 * the page says so rather than offering flows that may not exist.
 *
 * **The app password and the feed link are credentials.** Both stay in the form's state, are sent
 * once, and are cleared whether the harness took them or not; neither reaches the address, storage
 * or an error message. The harness's refusals are written codes that never echo what was sent.
 */

import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { PlugIcon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import {
  type Connection,
  type ConnectProvider,
  connectFeed,
  connectICloud,
  finishGoogleConnect,
  listConnections,
  listConnectProviders,
  listTenantConnections,
  RepoRouteError,
  removeConnection,
  revokeTenantConnection,
  startGoogleConnect,
  type TenantConnection,
} from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import { PageHeader, PageSection, Panel, PanelBody, plural } from '@/components/harness/panel';
import { connectReturnError, takeConnectReturn } from '@/lib/connect-return';

/** What each of Google's scopes lets an agent do, in the person's terms. */
const GOOGLE_SCOPES: Record<string, string> = {
  calendar_read: 'Read your calendar',
  calendar_events: 'Add events to your calendar',
  gmail_read: 'Read your email',
  gmail_compose: 'Save email drafts, never send them',
  drive_read: 'Read your Drive files',
};

/** The methods this client can draw; anything else a newer harness offers is left out. */
const KNOWN_METHODS = new Set(['oauth', 'app_password', 'feed_link']);

/** The harness's own words for a refusal it wrote, else the shared reading of the failure. */
function refusal(err: unknown, doing: string): string {
  return err instanceof RepoRouteError && !err.code.startsWith('http_')
    ? err.message
    : describeError(err, doing).message;
}

export function ConnectionsPage({ docs }: { docs: string }) {
  const [mine, setMine] = useState<Connection[] | null>(null);
  /** `null` is a harness without the route. */
  const [offers, setOffers] = useState<ConnectProvider[] | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [removeError, setRemoveError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    return Promise.all([listConnections(), listConnectProviders()])
      .then(([rows, offered]) => {
        setMine(rows);
        setOffers(offered);
      })
      .catch((err: unknown) => setLoadError(err));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // No cleanup guard: the return is taken once, so StrictMode's second run finds nothing, and
  // discarding the first run's answer would lose the only one there is.
  useEffect(() => {
    const back = takeConnectReturn();
    if (!back) return;
    if (back.kind === 'error') {
      setNotice({ text: connectReturnError(back.code), failed: true });
      return;
    }
    finishGoogleConnect()
      .then((kept) => {
        setNotice({ text: `Connected ${kept.label}.`, failed: false });
        return load();
      })
      .catch((err: unknown) =>
        setNotice({ text: refusal(err, 'keep this connection'), failed: true }),
      );
  }, [load]);

  const disconnect = (row: Connection) => {
    setRemoveError(null);
    return removeConnection(row.provider, row.account)
      .then(load)
      .catch((err: unknown) => setRemoveError(err));
  };

  const connected = (label: string) => {
    setNotice({ text: `Connected ${label}.`, failed: false });
    void load();
  };

  const usable = offers?.filter((o) => KNOWN_METHODS.has(o.method)) ?? [];

  return (
    <Panel>
      <PageHeader
        icon={<PlugIcon />}
        title="Connections"
        headingId="connections-page-heading"
        docs={docs}
        value={mine ? plural(mine.length, 'connection') : undefined}
      />
      <PanelBody>
        {notice && (
          <p
            role={notice.failed ? 'alert' : 'status'}
            className={
              notice.failed ? 'mb-3 text-sm text-state-failed' : 'mb-3 text-sm text-foreground'
            }
          >
            {notice.text}
          </p>
        )}
        {loadError ? (
          <ErrorNotice
            error={loadError}
            doing="read your connections"
            className="mb-5"
            action={
              <Button
                size="sm"
                variant="outline"
                className="h-7 self-start text-xs"
                onClick={() => void load()}
              >
                Try again
              </Button>
            }
          />
        ) : null}
        {mine && (
          <PageSection title="Yours">
            <p className="mb-2 max-w-prose text-sm text-muted-foreground">
              An agent acting for you can use these. Nobody else’s agent can.
            </p>
            {removeError ? (
              <ErrorNotice error={removeError} doing="disconnect this" className="mb-2" />
            ) : null}
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing connected yet.</p>
            ) : (
              <ul aria-label="Your connections" className="text-sm">
                {mine.map((row) => (
                  <ConnectionRow
                    key={`${row.provider}/${row.account}`}
                    row={row}
                    action={
                      <ConfirmButton
                        size="xs"
                        variant="ghost"
                        destructive
                        question={`Felix forgets ${row.label} and withdraws its access.`}
                        confirmLabel={`Disconnect ${row.label}`}
                        onConfirm={() => disconnect(row)}
                      >
                        Disconnect
                      </ConfirmButton>
                    }
                  />
                ))}
              </ul>
            )}
          </PageSection>
        )}
        {offers === null && (
          <p className="text-sm text-muted-foreground">
            This harness does not say what can be connected. It is older than this page.
          </p>
        )}
        {offers && (
          <PageSection title="Connect">
            {usable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This deployment offers nothing to connect.
              </p>
            ) : (
              <div className="space-y-5">
                {usable.map((offer) =>
                  offer.method === 'oauth' ? (
                    <GoogleConnect key={offer.provider} offer={offer} />
                  ) : offer.method === 'app_password' ? (
                    <ICloudConnect key={offer.provider} offer={offer} onConnected={connected} />
                  ) : (
                    <FeedConnect key={offer.provider} offer={offer} onConnected={connected} />
                  ),
                )}
              </div>
            )}
          </PageSection>
        )}
        <EveryonesConnections />
      </PanelBody>
    </Panel>
  );
}

function ConnectionRow({ row, who, action }: { row: Connection; who?: string; action: ReactNode }) {
  return (
    <li
      data-slot="connection"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 py-1.5 first:border-t"
    >
      <span className="font-medium">{row.label}</span>
      <span className="text-xs text-muted-foreground">{row.provider}</span>
      {who && <span className="font-mono text-xs text-muted-foreground">{who}</span>}
      {row.status === 'revoked' && (
        <span className="text-xs font-medium text-state-blocked">stopped working</span>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        connected {new Date(row.created_at).toLocaleDateString()}
      </span>
      {action}
    </li>
  );
}

/** Nothing is ticked to start with: what an agent may reach is the person's to choose. */
function GoogleConnect({ offer }: { offer: ConnectProvider }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await startGoogleConnect(
        `${window.location.origin}${window.location.pathname}`,
        chosen,
      );
      window.location.assign(url);
    } catch (err) {
      setError(refusal(err, `connect ${offer.label}`));
      setBusy(false);
    }
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{offer.label}</legend>
      {offer.scopes.map((scope) => (
        <label key={scope} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={chosen.includes(scope)}
            onChange={(e) =>
              setChosen((was) =>
                e.target.checked ? [...was, scope] : was.filter((s) => s !== scope),
              )
            }
          />
          {GOOGLE_SCOPES[scope] ?? scope}
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-state-failed">
          {error}
        </p>
      )}
      <Button size="sm" disabled={busy || chosen.length === 0} onClick={() => void start()}>
        Connect {offer.label}
      </Button>
    </fieldset>
  );
}

function SecretForm({
  title,
  help,
  doing,
  first,
  second,
  submit,
  onConnected,
}: {
  title: string;
  help: ReactNode;
  doing: string;
  first: { label: string };
  second: { label: string; type: 'password' | 'url' };
  submit: (first: string, secret: string) => Promise<Connection>;
  onConnected: (label: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const sending = secret;
    // Cleared before it is sent, so no outcome leaves it on screen.
    setSecret('');
    setBusy(true);
    setError(null);
    try {
      const kept = await submit(name.trim(), sending);
      setName('');
      onConnected(kept.label);
    } catch (err) {
      setError(refusal(err, doing));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="max-w-md space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{help}</p>
      <div>
        <Label htmlFor={`${id}-first`}>{first.label}</Label>
        <Input
          id={`${id}-first`}
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor={`${id}-secret`}>{second.label}</Label>
        <Input
          id={`${id}-secret`}
          type={second.type}
          value={secret}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setSecret(e.target.value)}
          className="mt-1 font-mono"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-state-failed">
          {error}
        </p>
      )}
      <Button size="sm" type="submit" disabled={busy || !name.trim() || !secret}>
        Connect
      </Button>
    </form>
  );
}

function ICloudConnect({
  offer,
  onConnected,
}: {
  offer: ConnectProvider;
  onConnected: (label: string) => void;
}) {
  return (
    <SecretForm
      title={offer.label}
      help="Use an app-specific password from appleid.apple.com, never your Apple ID password. Felix checks it with Apple before keeping it."
      doing={`connect ${offer.label}`}
      first={{ label: 'Apple ID' }}
      second={{ label: 'App-specific password', type: 'password' }}
      submit={connectICloud}
      onConnected={onConnected}
    />
  );
}

function FeedConnect({
  offer,
  onConnected,
}: {
  offer: ConnectProvider;
  onConnected: (label: string) => void;
}) {
  return (
    <SecretForm
      title={offer.label}
      help="A calendar’s published .ics link. Anyone holding the link can read the calendar, so Felix keeps it sealed. A name you have used replaces that link."
      doing="connect this calendar"
      first={{ label: 'Name' }}
      second={{ label: 'Link', type: 'url' }}
      submit={connectFeed}
      onConnected={onConnected}
    />
  );
}

/** For an administrator (`connections:admin`). A 403 is the ordinary answer for everyone else. */
function EveryonesConnections() {
  const [rows, setRows] = useState<TenantConnection[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revokeError, setRevokeError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    listTenantConnections()
      .then((items) => alive && setRows(items))
      .catch((err: unknown) => {
        if (!alive) return;
        const refused = err instanceof RepoRouteError && (err.status === 403 || err.status === 404);
        if (refused) setHidden(true);
        else setError(err);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (hidden) return null;
  if (error) {
    return (
      <PageSection title="Everyone’s connections">
        <ErrorNotice error={error} doing="list the tenant’s connections" />
      </PageSection>
    );
  }
  if (rows === null) return null;

  const revoke = (row: TenantConnection) => {
    setRevokeError(null);
    return revokeTenantConnection(row.person, row.provider, row.account)
      .then(() =>
        setRows((cur) =>
          (cur ?? []).filter(
            (r) =>
              !(
                r.person === row.person &&
                r.provider === row.provider &&
                r.account === row.account
              ),
          ),
        ),
      )
      .catch((err: unknown) => setRevokeError(err));
  };

  return (
    <PageSection title="Everyone’s connections" meta={plural(rows.length, 'connection')}>
      {revokeError ? (
        <ErrorNotice error={revokeError} doing="revoke this connection" className="mb-2" />
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody here has connected anything.</p>
      ) : (
        <ul aria-label="Connections in this tenant" className="text-sm">
          {rows.map((row) => (
            <ConnectionRow
              key={`${row.person}/${row.provider}/${row.account}`}
              row={row}
              who={row.person.slice(row.person.lastIndexOf('|') + 1)}
              action={
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  destructive
                  question={`Felix forgets ${row.label} for this person and withdraws its access.`}
                  confirmLabel={`Revoke ${row.label}`}
                  onConfirm={() => revoke(row)}
                >
                  Revoke
                </ConfirmButton>
              }
            />
          ))}
        </ul>
      )}
    </PageSection>
  );
}
