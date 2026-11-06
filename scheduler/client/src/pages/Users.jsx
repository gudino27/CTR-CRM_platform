/**
 * Users page: team members. Add, edit, change role, deactivate.
 *
 * What lives here:
 *   ROLES       the roles from most to least access
 *   rank        a role's place in ROLES as a number (higher = more access)
 *   EMPTY       the blank "Add a user" form
 *   RoleSelect  the role dropdown used by both forms
 *   Users       the page (route /users, needs manageUsers)
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ROLE_LABELS, useCurrentUser } from '../currentUser.js';

// Order matters: rank() reads it, most access first
const ROLES = ['superAdmin', 'admin', 'manager', 'employee'];
const rank = (role) => ROLES.length - ROLES.indexOf(role);
const EMPTY = { name: '', email: '', role: 'employee' };

/**
 * A dropdown of roles with their readable labels.
 *
 * Usage:
 *   <RoleSelect value={draft.role} roles={roles} onChange={(role) => setDraft({ ...draft, role })} />
 *
 * Takes:
 *   value    - the selected role key (e.g. "employee", shown as "Team member")
 *   onChange - called with the new role key
 *   roles    - the role keys to offer (only the ones this person may hand out)
 *   id       - optional id for a <label htmlFor>
 *
 * Returns:
 *   A <select> with one option per role, labelled from ROLE_LABELS (currentUser.js).
 */
function RoleSelect({ value, onChange, roles, id }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
    </select>
  );
}

/**
 * The Users page: a table of everyone (active and deactivated) with Edit and
 * Deactivate/Reactivate, an "Add a user" form, and the delete control for the temporary
 * setup account.
 *
 * Usage:
 *   Rendered by App.jsx for the /users route (needs manageUsers): <Users />
 *
 * Returns:
 *   The page section. Errors show as one red line, successes as one notice line.
 *
 * How it works:
 *   1. Super admins manage everyone; others manage roles at or below their own, never
 *      super admins. The role dropdown offers only those roles, and each row's
 *      user.canManage (from the server) decides whether Edit/Deactivate show.
 *   2. Every change goes through run(): it clears the messages, calls the API, reloads
 *      the list and refreshes the current user (in case someone changed their own role).
 *   3. The temporary setup account can only be deleted (never edited), by a super admin,
 *      once a real active super admin exists; deleting it asks for an inline confirm.
 *   4. Deactivated users stay in the list so the activity log keeps their name.
 *
 * When editing:
 *   The server checks every rule above too (server/src/routes/users.js); the hiding here
 *   is only so people are not offered what will be refused. There is always at least
 *   one active super admin; the server enforces that.
 */
export default function Users() {
  const { user: me, refresh } = useCurrentUser();
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // { id, name, email, role }
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // id of the setup account being deleted

  // Roles this person may hand out (the server checks too)
  const roles = ROLES.filter((role) => me.role === 'superAdmin' || (role !== 'superAdmin' && rank(role) <= rank(me.role)));

  const load = () => api.users().then(setUsers).catch((error) => setMessage(error.message));
  useEffect(() => {
    load();
  }, []);

  /**
   * Runs one change and then refreshes the page.
   *
   * Usage:
   *   run(() => api.addUser(draft), () => setNotice('Added.'))
   *
   * Takes:
   *   action - async function that calls the API
   *   done   - optional; called after a success, before the list reloads
   *
   * Returns:
   *   Nothing; on error shows the server's message and skips done and the reload.
   */
  async function run(action, done) {
    setMessage('');
    setNotice('');
    try {
      await action();
      done?.();
      await load();
      refresh(); // in case someone changed their own role
    } catch (error) {
      setMessage(error.message);
    }
  }

  function addUser(event) {
    event.preventDefault();
    run(() => api.addUser(draft), () => {
      setNotice(`${draft.name} was added.`);
      setDraft(EMPTY);
    });
  }

  function saveEdit(event) {
    event.preventDefault();
    const { id, ...changes } = editing;
    run(() => api.updateUser(id, changes), () => {
      setNotice(`${changes.name} was saved.`);
      setEditing(null);
    });
  }

  const realSuperAdmins = users.filter((u) => u.role === 'superAdmin' && u.active && !u.isSetup).length;

  /**
   * Deletes the setup account after the inline confirm.
   *
   * Takes:
   *   user - the setup account's row
   *
   * How it works:
   *   Deleting yourself signs you out, so that case does not reload the list: it only
   *   refreshes the current user and App.jsx shows the sign-in screen. Anyone else's
   *   delete goes through run() as usual.
   */
  async function deleteSetup(user) {
    setConfirmDelete(null);
    if (user.id === me.id) {
      setMessage('');
      try {
        await api.deleteUser(user.id);
      } catch (error) {
        setMessage(error.message);
        return;
      }
      refresh();
      return;
    }
    run(() => api.deleteUser(user.id), () => setNotice('The setup account was deleted.'));
  }

  /**
   * The Actions cell for the setup account: a reason it cannot be deleted yet (not a
   * super admin, or no real super admin exists), the Delete button, or the inline confirm.
   *
   * Takes:
   *   user - the setup account's row
   *
   * Returns:
   *   JSX for the cell.
   */
  function setupActions(user) {
    if (me.role !== 'superAdmin') return <span className="field-hint">Only super admins can delete the setup account</span>;
    if (realSuperAdmins === 0) return <span className="field-hint">Add a real super admin first, then delete this account</span>;
    if (confirmDelete === user.id) {
      return (
        <span role="group" aria-label="Confirm delete">
          <span>Delete it for good?{user.id === me.id ? ' You will be signed out.' : ''} </span>
          <button type="button" className="remove-button" onClick={() => deleteSetup(user)}>Delete</button>
          <button type="button" className="secondary-button" onClick={() => setConfirmDelete(null)}>Keep it</button>
        </span>
      );
    }
    return (
      <button type="button" className="remove-button" onClick={() => setConfirmDelete(user.id)}>
        Delete setup account
      </button>
    );
  }

  const setActive = (user, active) =>
    run(() => api.updateUser(user.id, { active }), () => setNotice(`${user.name} was ${active ? 'reactivated' : 'deactivated'}.`));

  return (
    <section>
      <h1>Users</h1>
      <p>
        About four people schedule posts. Deactivated users can no longer sign in; they stay in the list so the
        activity log keeps their name.
      </p>
      {message && <p className="error-text" role="alert">{message}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="table-wrap">
        <table className="inventory-table users-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {users.map((user) => (editing?.id === user.id ? (
              <tr key={user.id}>
                <td colSpan={5}>
                  <form className="user-form" onSubmit={saveEdit}>
                    <label>Name <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></label>
                    <label>Email <input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} required /></label>
                    <label>Role <RoleSelect value={editing.role} roles={roles} onChange={(role) => setEditing({ ...editing, role })} /></label>
                    <div className="post-actions">
                      <button type="submit">Save</button>
                      <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={user.id} className={user.active ? undefined : 'user-inactive'}>
                <td>
                  {user.name}
                  {user.isSetup && <span className="setup-badge">Temporary</span>}
                  {user.id === me.id && <span className="field-hint"> (you)</span>}
                </td>
                <td>{user.email}</td>
                <td>{ROLE_LABELS[user.role]}</td>
                <td>{user.active ? 'Active' : 'Deactivated'}</td>
                <td className="user-actions">
                  {user.isSetup ? setupActions(user) : user.canManage ? (
                    <>
                      <button type="button" className="secondary-button"
                        onClick={() => setEditing({ id: user.id, name: user.name, email: user.email, role: user.role })}>
                        Edit
                      </button>
                      <button type="button" className="secondary-button" onClick={() => setActive(user, !user.active)}>
                        {user.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </>
                  ) : (
                    <span className="field-hint">Only super admins can change this user</span>
                  )}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      <h2>Add a user</h2>
      <form className="user-form" onSubmit={addUser}>
        <label>Name <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
        <label>Email <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required /></label>
        <label>Role <RoleSelect value={draft.role} roles={roles} onChange={(role) => setDraft({ ...draft, role })} /></label>
        <div className="post-actions">
          <button type="submit">Add user</button>
        </div>
      </form>
      <p className="field-hint">
        Roles changed here stick. SUPER_ADMIN_EMAILS on the server only creates super admins who have no account yet,
        and the server makes a temporary setup account only when there is no active super admin at all.
        There is always at least one active super admin.
      </p>
    </section>
  );
}
