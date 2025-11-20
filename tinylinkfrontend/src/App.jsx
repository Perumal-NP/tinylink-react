import React, { useEffect, useState } from 'react';
import './index.css'; // <- must import Tailwind CSS


// TinyLink React frontend (single-file)
// - Tailwind CSS classes are used for styling (assumes Tailwind is set up in your project)
// - Exports a default React component you can mount in your app
// - Configure API_BASE to point to your backend if it's not the same origin

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE)
  || process.env.REACT_APP_API_BASE
  || ''; // default '' -> same origin

function formatDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleString();
  } catch (e) {
    return d;
  }
}

function useFetchLinks(initialLimit = 20) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(initialLimit);
  const [offset, setOffset] = useState(0);

  const fetchPage = async (l = limit, o = offset) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/links?limit=${l}&offset=${o}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRows(data.rows || []);
    } catch (err) {
      console.error('fetchPage error', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, offset]);

  return { rows, loading, limit, offset, setLimit, setOffset, fetchPage };
}

export default function TinyLinkApp() {
  const { rows, loading, limit, offset, setOffset, fetchPage } = useFetchLinks(20);
  const [target, setTarget] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState(null);
  const [selected, setSelected] = useState(null);

  function validateCustomCode(code) {
  if (!code) return { ok: true }; // empty allowed (server generates one)
  const c = code.trim();
  // adjust rules to match your backend constraints:
  if (c.length < 4 || c.length > 12) {
    return { ok: false, msg: 'Custom code must be 4–12 characters.' };
  }
  if (!/^[A-Za-z0-9-_]+$/.test(c)) {
    return { ok: false, msg: 'Custom code may only contain letters, numbers, hyphen and underscore.' };
  }
  return { ok: true, code: c };
}

// improved createLink
const createLink = async (e) => {
  e && e.preventDefault();
  setMessage(null);
  const trimmedTarget = (target || '').trim();
  if (!trimmedTarget) return setMessage({ type: 'error', text: 'Target URL is required' });

  // client-side custom code validation
  const v = validateCustomCode(customCode);
  if (!v.ok) return setMessage({ type: 'error', text: v.msg });

  setCreating(true);
  try {
    const body = { target: trimmedTarget };
    if (v.code) body.code = v.code; // send trimmed/validated code

    const res = await fetch(`${API_BASE}/api/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // try to parse json; show server message when available
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (err) { data = null; }

    if (!res.ok) {
      // prefer structured server message, fallback to plain text
      const errMsg = data && (data.error || data.message) ? (data.error || data.message) : (text || `Status ${res.status}`);
      throw new Error(errMsg);
    }

    // success
    setMessage({ type: 'success', text: `Created: ${data.shortUrl || data.short || (data.code ? `${window.location.origin}/${data.code}` : 'OK')}` });
    setTarget('');
    setCustomCode('');
    fetchPage();
    setSelected(data);
  } catch (err) {
    console.error('createLink error', err);
    // show exact server-provided message when possible
    setMessage({ type: 'error', text: err.message || 'Failed to create' });
  } finally {
    setCreating(false);
  }
};

  const deleteLink = async (code) => {
    if (!window.confirm(`Delete ${code}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/links/${code}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setMessage({ type: 'success', text: `Deleted ${code}` });
      fetchPage();
      if (selected && selected.code === code) setSelected(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to delete' });
    }
  };

  const viewDetails = async (code) => {
    try {
      const res = await fetch(`${API_BASE}/api/links/${code}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSelected(data);
      setMessage(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load details' });
    }
  };

  const testRedirect = async (code) => {
    try {
      const res = await fetch(`${API_BASE}/${code}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMessage({ type: 'info', text: `Redirect target: ${data.target}` });
      fetchPage(); // update clicks
      viewDetails(code);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Test redirect failed' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold">TinyLink — Admin</h1>
          <p className="text-sm text-gray-600">Create, view and manage short links.</p>
        </header>

        <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section className="md:col-span-1 bg-white p-4 rounded-2xl shadow-sm">
            <h2 className="text-lg font-medium mb-2">Create Link</h2>
            <form onSubmit={createLink} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Target URL</label>
                <input
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="https://example.com/page"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Custom code (optional)</label>
                <input
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="6-8 alphanumeric chars"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">If left empty a random code will be generated.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm shadow-sm disabled:opacity-60"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setTarget(''); setCustomCode(''); setMessage(null); }}
                  className="px-3 py-2 rounded-lg border text-sm"
                >
                  Reset
                </button>
              </div>
            </form>

            {message && (
              <div className={`mt-4 p-3 rounded-md text-sm ${message.type === 'error' ? 'bg-red-50 text-red-700' : message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                {message.text}
              </div>
            )}

            {selected && (
              <div className="mt-4 border-t pt-4">
                <h3 className="text-sm font-medium">Selected</h3>
                <p className="text-sm break-all">Short: <a className="text-blue-600" href={selected.shortUrl} target="_blank" rel="noreferrer">{selected.shortUrl}</a></p>
                <p className="text-sm">Target: <span className="break-all">{selected.target}</span></p>
                <p className="text-sm">Clicks: {selected.clicks}</p>
                <p className="text-sm">Created: {formatDate(selected.created_at)}</p>
                <p className="text-sm">Last clicked: {formatDate(selected.last_clicked)}</p>
                <div className="flex gap-2 mt-3">
                  <button className="px-3 py-1 rounded border text-sm" onClick={() => testRedirect(selected.code)}>Test redirect</button>
                  <button className="px-3 py-1 rounded border text-sm text-red-600" onClick={() => deleteLink(selected.code)}>Delete</button>
                  <button className="px-3 py-1 rounded border text-sm" onClick={() => setSelected(null)}>Close</button>
                </div>
              </div>
            )}
          </section>

          <section className="md:col-span-2 bg-white p-4 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">Links</h2>
              <div className="text-sm text-gray-600">Showing up to {limit}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm table-auto">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="pb-2">Short</th>
                    <th className="pb-2">Target</th>
                    <th className="pb-2">Clicks</th>
                    <th className="pb-2">Last clicked</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="py-6 text-center">Loading...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-500">No links yet</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.code} className="border-t">
                      <td className="py-3 align-top"><a className="text-blue-600" href={r.shortUrl} target="_blank" rel="noreferrer">{r.code}</a></td>
                      <td className="py-3 align-top break-all">{r.target}</td>
                      <td className="py-3 align-top">{r.clicks}</td>
                      <td className="py-3 align-top">{formatDate(r.last_clicked)}</td>
                      <td className="py-3 align-top">
                        <div className="flex gap-2">
                          <button onClick={() => viewDetails(r.code)} className="px-2 py-1 rounded border text-sm">View</button>
                          <button onClick={() => testRedirect(r.code)} className="px-2 py-1 rounded border text-sm">Test</button>
                          <button onClick={() => deleteLink(r.code)} className="px-2 py-1 rounded border text-sm text-red-600">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">Page controls</div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1 rounded border text-sm" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>Prev</button>
                <button className="px-3 py-1 rounded border text-sm" onClick={() => setOffset(offset + limit)} disabled={rows.length < limit}>Next</button>
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-6 text-center text-xs text-gray-500">TinyLink &copy; 2025</footer>
      </div>
    </div>
  );
}
