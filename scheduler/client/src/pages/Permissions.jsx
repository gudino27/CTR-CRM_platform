/**
 * Permissions page: super admins decide what each role may do. Super admins always have
 * everything.
 *
 * What lives here:
 *   CONFIRM_WORDS  what a super admin types before giving a role a delete permission
 *   Permissions    the page (route /permissions)
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useCurrentUser } from '../currentUser.js';

const CONFIRM_WORDS = 'allow delete';

/**
 * The Permissions page: a role x permission table of checkboxes, saved together.
 *
 * Usage:
 *   Rendered by App.jsx for the /permissions route (super admins only): <Permissions />
 *
 * Returns:
 *   The page section: the table (the super admin column is shown but disabled, since
 *   super admins always have everything), Save / Undo buttons, and, when a delete
 *   permission is being turned on, a typed-confirm box.
 *
 * How it works:
 *   1. Loads { roles, permissions, table } from GET /api/permissions and keeps an edited
 *      copy of the table; Save is enabled only when the copy differs.
 *   2. Ticking a box changes only the copy; nothing is sent until Save.
 *   3. Save (see save() below) asks for a typed confirm before turning on any risky
 *      (delete) permission, then sends the editable roles' rows.
 *   4. After saving, refreshes the current user so the menu and hidden controls follow
 *      the new permissions right away.
 *
 * When editing:
 *   Permission keys, labels and which ones are "risky" come from the server
 *   (server/src/services/permissions.js and the rolePermission table); a new key shows up
 *   here without client changes. The server also refuses risky grants without
 *   confirmRisky, so the typed confirm is not the only guard.
 */
export default function Permissions() {
  const { refresh } = useCurrentUser();
  const [data, setData] = useState(null); // { roles, permissions, table }
  const [table, setTable] = useState(null); // edited copy
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  // Turning on a delete permission: the grants waiting for a typed confirm, and what was typed
  const [pendingRisky, setPendingRisky] = useState(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    api.permissions().then((result) => {
      setData(result);
      setTable(result.table);
    }).catch((error) => setMessage(error.message));
  }, []);

  if (!data) return <section><h1>Permissions</h1>{message && <p className="error-text" role="alert">{message}</p>}</section>;

  const editableRoles = data.roles.filter((role) => role.editable);
  const changed = editableRoles.some((role) => data.permissions.some((p) => table[role.key][p.key] !== data.table[role.key][p.key]));
  const toggle = (role, permission) =>
    setTable({ ...table, [role]: { ...table[role], [permission]: !table[role][permission] } });

  /**
   * Saves the edited table. Turning on a delete permission for any role first shows a warning
   * with a typed confirm (CONFIRM_WORDS); the server refuses it without confirmRisky as well.
   *
   * Usage:
   *   save()      // from the Save button; may stop at the typed confirm
   *   save(true)  // from "Allow deleting" after the words were typed
   *
   * Takes:
   *   confirmRisky - true once the typed confirm was done; default false
   *
   * Returns:
   *   Nothing. On success the table is replaced by the server's copy and a notice shows;
   *   on error the server's message shows.
   *
   * How it works:
   *   1. Lists the risky permissions that are being turned ON now (off before, on in the
   *      copy). Turning one off needs no confirm.
   *   2. If there are any and confirmRisky is false, opens the confirm box and stops.
   *   3. Otherwise sends every editable role's row with confirmRisky.
   */
  async function save(confirmRisky = false) {
    setMessage('');
    setNotice('');
    const grants = editableRoles.flatMap((role) => data.permissions
      .filter((p) => p.risky && table[role.key][p.key] && !data.table[role.key][p.key])
      .map((p) => ({ role: role.label, label: p.label })));
    if (grants.length && !confirmRisky) {
      setPendingRisky(grants);
      setTyped('');
      return;
    }
    try {
      const edits = Object.fromEntries(editableRoles.map((role) => [role.key, table[role.key]]));
      const result = await api.savePermissions(edits, confirmRisky);
      setData(result);
      setTable(result.table);
      setPendingRisky(null);
      setNotice('Permissions saved. They apply to everyone right away.');
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section>
      <h1>Permissions</h1>
      <p>Tick what each role may do. Super admins can always do everything, so their column cannot be changed.</p>
      {message && <p className="error-text" role="alert">{message}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="table-wrap">
        <table className="inventory-table permissions-table">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {data.roles.map((role) => <th key={role.key} scope="col">{role.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.permissions.map((permission) => (
              <tr key={permission.key}>
                <th scope="row">
                  {permission.label}
                  {permission.risky && <span className="risky-badge"> Can't be undone</span>}
                </th>
                {data.roles.map((role) => (
                  <td key={role.key}>
                    <input
                      type="checkbox"
                      aria-label={`${role.label}: ${permission.label}`}
                      checked={table[role.key][permission.key]}
                      disabled={!role.editable}
                      onChange={() => toggle(role.key, permission.key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="post-actions">
        <button type="button" onClick={() => save()} disabled={!changed || Boolean(pendingRisky)}>Save permissions</button>
        <button type="button" className="secondary-button"
          onClick={() => { setTable(data.table); setPendingRisky(null); }} disabled={!changed}>Undo changes</button>
      </div>
      {pendingRisky && (
        <div className="risky-confirm" role="alertdialog" aria-labelledby="riskyTitle">
          <p id="riskyTitle"><strong>You are about to let people delete.</strong></p>
          <ul>
            {pendingRisky.map((grant) => <li key={`${grant.role}-${grant.label}`}>{grant.role}: {grant.label}</li>)}
          </ul>
          <p>Deleted posts can't be brought back, and deleted images can only be restored from Recently deleted for a few days.
            Type <strong>{CONFIRM_WORDS}</strong> to confirm.</p>
          <input type="text" aria-label={`Type ${CONFIRM_WORDS} to confirm`} value={typed}
            onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
          <div className="post-actions">
            <button type="button" className="remove-button" disabled={typed.trim().toLowerCase() !== CONFIRM_WORDS}
              onClick={() => save(true)}>Allow deleting</button>
            <button type="button" className="secondary-button" onClick={() => setPendingRisky(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
