/**
 * The relay's card on the harness's **Plugin configuration** tab.
 *
 * What belongs here and what does not: pairing, revocation, and the
 * certificate pin live on the relay's own pages, because they must work before
 * a person is signed in and from a device that is not this one. This card is
 * the configuration surface — the switches that change how the relay behaves —
 * plus the way in to those pages.
 *
 * The card is only ever rendered on loopback. The harness decides whether a
 * settings namespace is writable from `connection.isLoopback`, computed in the
 * browser from the page address, so a remote browser is served no namespaces
 * and this tab dispatches no cards at all. The snapshot's `writable` flag is
 * what that looks like from in here.
 *
 * Edits are staged and written on save, as the neighbouring cards do. That is
 * not only for consistency: saving a relay field rebinds the listeners and
 * drops the connections in flight, so a control that committed as it settled
 * turned one change of mind into several disconnections.
 * @module dsh-relay/client/RelayCard
 */

import { useState } from 'react'
import css from './RelayCard.module.css'

/** One switch the card offers. */
interface Choice {
  readonly field: string
  readonly label: string
  readonly hint: string
  readonly options: readonly { readonly value: string, readonly label: string }[]
}

/** The switches, in the order a person reasons about them. */
const CHOICES: readonly Choice[] = [
  {
    field: 'privilegedMethods',
    label: 'Configuration access for remote clients',
    hint: 'The harness serves settings, credentials, model discovery, and its directory pickers only to the machine it runs on. This decides whether an authenticated remote client reaches them too. Clients admitted by network address never do.',
    options: [
      { value: 'allow-authenticated', label: 'Allow once authenticated' },
      { value: 'loopback-only', label: 'This machine only' },
    ],
  },
  {
    field: 'uiLink',
    label: 'Relay link in this UI',
    hint: 'The small link in the corner that reaches the relay pages.',
    options: [{ value: 'true', label: 'Shown' }, { value: 'false', label: 'Hidden' }],
  },
  {
    field: 'mdns',
    label: 'Announce on the local network',
    hint: 'Publishes _dsh._tcp so a client can find this relay without scanning the subnet.',
    options: [{ value: 'true', label: 'Announced' }, { value: 'false', label: 'Quiet' }],
  },
]

/** The relay configuration this card reads. */
interface RelayValue {
  readonly bind?: string
  readonly port?: number
  readonly tls?: string
  readonly privilegedMethods?: string
  readonly uiLink?: boolean
  readonly mdns?: boolean
  readonly compat?: { readonly addressGrants?: boolean, readonly plainPort?: number }
}

/** The snapshot the renderer binds from the settings scope. */
interface RelaySnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: RelayValue | undefined
  readonly writable: boolean
}

/** Props the renderer composes for this card. */
export interface RelayCardProps {
  /** Bound from the injected `hooks` compartment. */
  useRelayCard: <T>(select: (snapshot: RelaySnapshot) => T) => T
  /** Write one top-level field of the namespace; resolves to whether it landed. */
  setField: (field: string, value: unknown) => Promise<boolean>
}

/** Parse the string a control carries back into the value the field holds. */
function parseChoice(field: string, raw: string): unknown {
  if (field === 'privilegedMethods') return raw
  return raw === 'true'
}

/** Render the value currently in effect for one choice. */
function currentChoice(field: string, value: RelayValue | undefined): string {
  if (field === 'privilegedMethods') return value?.privilegedMethods ?? 'allow-authenticated'
  if (field === 'uiLink') return String(value?.uiLink ?? true)
  return String(value?.mdns ?? true)
}

/**
 * The chevron the neighbouring card headers use, drawn here rather than
 * imported: the icon set is a module-table row, but depending on it would pin
 * this plugin to one harness release for one path.
 * @param props.className - the rotation class the header applies.
 * @returns the 14px glyph.
 */
function Chevron(props: { className?: string | undefined }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Render the relay's configuration card.
 * @param props - the bound snapshot hook and the field writer.
 * @returns the card.
 */
export function RelayCard(props: RelayCardProps) {
  const snapshot = props.useRelayCard(current => current)
  // Disclosure is card-local: which card a person has open is a reading
  // gesture, and the neighbouring cards start closed.
  const [open, setOpen] = useState(false)
  // Drafts hold the option strings the controls carry, so the same two helpers
  // that read the stored value also convert an edit back on save.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const value = snapshot.value
  const readOnly = !snapshot.writable

  if (snapshot.status === 'loading') {
    return <li className={css.card}><p className={css.loading}>Loading the relay configuration…</p></li>
  }

  const selected = (field: string): string => drafts[field] ?? currentChoice(field, value)
  // Compared against the live snapshot rather than against whether a draft
  // exists, so staging a value back to what already stands is not "unsaved".
  const dirty = CHOICES.some(choice => selected(choice.field) !== currentChoice(choice.field, value))

  const stage = (field: string, raw: string): void => {
    setFailed(false)
    setDrafts(current => ({ ...current, [field]: raw }))
  }

  const save = (): void => {
    setSaving(true)
    setFailed(false)
    const pending = CHOICES
      .filter(choice => selected(choice.field) !== currentChoice(choice.field, value))
      .map(choice => ({ field: choice.field, raw: selected(choice.field) }))
    void (async () => {
      // Sequentially: each write is a revision-fenced document mutation, and
      // two in flight at once can lose to each other's revision.
      let landed = true
      for (const edit of pending) {
        const ok = await props.setField(edit.field, parseChoice(edit.field, edit.raw))
        if (!ok) landed = false
      }
      setSaving(false)
      // A save that did not land keeps its drafts, so the person can retry
      // rather than retype. The next snapshot shows what actually stands.
      if (landed) setDrafts({})
      else setFailed(true)
    })()
  }

  const scheme = value?.tls === 'off' ? 'http' : 'https'
  const port = value?.port ?? 3443
  const plainPort = value?.compat?.plainPort ?? 0

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      {/* The section's own card chrome is a component of another plugin, and a
          cross-plugin value import is neither resolvable through the module
          table nor permitted, so the card renders its own to the same
          geometry. */}
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>Relay</span>
          <span className={css.description}>Remote access to this harness</span>
        </span>
        {dirty ? <span className={css.pending}>Unsaved</span> : null}
        <Chevron className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>

      {open
        ? (
          <div className={css.body}>
            {readOnly
              ? <p className={css.readOnly} role="status">Served read-only to this browser.</p>
              : null}

            <div className={css.field}>
              <span className={css.label}>Listening</span>
              <span className={css.value}>
                {`${scheme}://<this machine>:${String(port)}`}
                {value?.bind === '127.0.0.1' ? ' — loopback only, no device can reach it' : ''}
              </span>
            </div>

            <div className={css.field}>
              <span className={css.label}>Transport</span>
              <span className={css.value}>
                {value?.tls === 'off'
                  ? 'Plaintext — anything on the network path can read the traffic and the credentials on it'
                  : value?.tls === 'files'
                    ? 'A certificate you supplied'
                    : 'Self-signed, with a pin published on the pairing page'}
              </span>
            </div>

            {plainPort > 0 && (
              <div className={css.warn}>
                {`A plain listener is running on port ${String(plainPort)} for DSH Mobile 0.5.0. It carries no configuration access, and the clients it admits are recognised by network address rather than a credential.`}
              </div>
            )}

            {CHOICES.map(choice => (
              <div className={css.field} key={choice.field}>
                <span className={css.label}>{choice.label}</span>
                <div className={css.segmented} role="group" aria-label={choice.label}>
                  {choice.options.map((option) => {
                    const on = option.value === selected(choice.field)
                    return (
                      <button
                        type="button"
                        key={option.value}
                        className={on ? `${css.segment} ${css.segmentOn}` : css.segment}
                        aria-pressed={on}
                        disabled={readOnly || saving}
                        onClick={() => { stage(choice.field, option.value) }}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                <p className={css.hint}>{choice.hint}</p>
              </div>
            ))}

            <div className={css.actions}>
              <a className={css.action} href="/relay/pair">Pair a device</a>
              <a className={css.action} href="/relay/devices">Paired devices</a>
              <a className={css.action} href="/relay/password">Change the password</a>
            </div>

            {dirty
              ? (
                <div className={css.footer}>
                  {failed
                    ? <p className={css.failed} role="status">That did not save. The values above are still staged.</p>
                    : null}
                  <button
                    type="button"
                    className={css.discard}
                    disabled={saving}
                    onClick={() => { setDrafts({}); setFailed(false) }}
                  >
                    Discard
                  </button>
                  <button type="button" className={css.save} disabled={saving} onClick={save}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )
              : null}

            <p className={css.hint}>
              Saving rebinds the listeners, which drops connections in flight — a phone mid-session
              reconnects on its own.
            </p>
          </div>
        )
        : null}
    </li>
  )
}
