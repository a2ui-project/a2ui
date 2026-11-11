/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {useEffect, useState} from 'react';

interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, string>;
  sampleArgs: Record<string, unknown>;
  returns: string;
}

interface SummaryData {
  totalOrders: number;
  totalCompanies: number;
  totalSpend: number;
  regions: string[];
  dateRange: string;
}

interface CompanyItem {
  name: string;
  industry?: string;
  hq?: string;
  tier?: string;
  region: string;
  totalSpend: number;
  orderCount: number;
  latestOrderDate: string;
  topProducts: string[];
}

interface OrderItem {
  id: string;
  date: string;
  customer: string;
  region: string;
  product: string;
  amount: number;
}

interface ToolsAndDataResponse {
  ok: boolean;
  tools: ToolInfo[];
  summary: SummaryData;
  companies: CompanyItem[];
  sampleOrders: OrderItem[];
}

export function ToolsAndDataPanel({onClose}: {onClose: () => void}) {
  const [data, setData] = useState<ToolsAndDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'tools' | 'companies' | 'orders' | 'tester'>('tools');

  // Filter state for companies
  const [companySearch, setCompanySearch] = useState('');
  const [companyRegion, setCompanyRegion] = useState('All');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companyDetails, setCompanyDetails] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Filter state for orders
  const [orderSearch, setOrderSearch] = useState('');
  const [orderRegion, setOrderRegion] = useState('All');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  // Tester state
  const [testerTool, setTesterTool] = useState('queryCompanies');
  const [testerArgs, setTesterArgs] = useState(
    '{\n  "region": "All",\n  "sortBy": "totalSpend",\n  "limit": 5\n}',
  );
  const [testerOutput, setTesterOutput] = useState<string | null>(null);
  const [testerRunning, setTesterRunning] = useState(false);
  const [testerDuration, setTesterDuration] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/tools-and-data')
      .then(res => res.json())
      .then((res: ToolsAndDataResponse) => {
        if (active && res.ok) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Failed to load tools and data:', err);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const inspectCompany = async (companyName: string) => {
    setSelectedCompany(companyName);
    setLoadingDetails(true);
    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'getCompanyDetails', args: {company: companyName}}),
      });
      const json = await res.json();
      setCompanyDetails(json.result ?? null);
    } catch {
      setCompanyDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const inspectOrder = async (orderId: string) => {
    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'getOrderDetails', args: {orderId}}),
      });
      const json = await res.json();
      setSelectedOrder(json.result ?? null);
    } catch {
      setSelectedOrder(null);
    }
  };

  const runTester = async () => {
    setTesterRunning(true);
    setTesterOutput(null);
    try {
      const parsedArgs = JSON.parse(testerArgs);
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: testerTool, args: parsedArgs}),
      });
      const json = await res.json();
      setTesterDuration(json.durationMs ?? null);
      setTesterOutput(JSON.stringify(json.result ?? json.error, null, 2));
    } catch (e: any) {
      setTesterOutput(`Error parsing arguments or executing: ${e.message}`);
    } finally {
      setTesterRunning(false);
    }
  };

  const selectToolForTester = (tool: ToolInfo) => {
    setTesterTool(tool.name);
    setTesterArgs(JSON.stringify(tool.sampleArgs, null, 2));
    setTab('tester');
    setTesterOutput(null);
  };

  const filteredCompanies = (data?.companies ?? []).filter(c => {
    const matchesRegion = companyRegion === 'All' || c.region === companyRegion;
    const matchesQuery =
      companySearch === '' ||
      c.name.toLowerCase().includes(companySearch.toLowerCase()) ||
      (c.industry && c.industry.toLowerCase().includes(companySearch.toLowerCase())) ||
      (c.tier && c.tier.toLowerCase().includes(companySearch.toLowerCase()));
    return matchesRegion && matchesQuery;
  });

  const filteredOrders = (data?.sampleOrders ?? []).filter(o => {
    const matchesRegion = orderRegion === 'All' || o.region === orderRegion;
    const matchesQuery =
      orderSearch === '' ||
      o.customer.toLowerCase().includes(orderSearch.toLowerCase()) ||
      o.product.toLowerCase().includes(orderSearch.toLowerCase()) ||
      o.id.toLowerCase().includes(orderSearch.toLowerCase());
    return matchesRegion && matchesQuery;
  });

  return (
    <section
      className="about tools-panel"
      data-testid="tools-and-data-panel"
      aria-label="Tools and Data Explorer"
    >
      <div className="about-inner">
        <div className="about-head">
          <div>
            <h2>Agent Tools &amp; Mock Dataset</h2>
            <p className="tools-panel-sub">
              Explore the deterministic database and the 5 RPC tools the agent and ReactApps can
              call.
            </p>
          </div>
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? (
          <p className="turn-thinking">
            Loading tools and dataset
            <span className="dots" aria-hidden="true" />
          </p>
        ) : !data ? (
          <p className="turn-note turn-error">Could not load tools and data from the agent.</p>
        ) : (
          <>
            {/* Stats Summary Bar */}
            <div className="tools-stats-bar">
              <div className="tools-stat">
                <span className="tools-stat-val">{data.summary.totalCompanies}</span>
                <span className="tools-stat-lbl">Companies</span>
              </div>
              <div className="tools-stat">
                <span className="tools-stat-val">{data.summary.totalOrders}</span>
                <span className="tools-stat-lbl">Sales Orders</span>
              </div>
              <div className="tools-stat">
                <span className="tools-stat-val">
                  ${Math.round(data.summary.totalSpend).toLocaleString()}
                </span>
                <span className="tools-stat-lbl">2025 Total Volume</span>
              </div>
              <div className="tools-stat">
                <span className="tools-stat-val">{data.summary.regions.length}</span>
                <span className="tools-stat-lbl">Global Regions</span>
              </div>
              <div className="tools-stat">
                <span className="tools-stat-val">{data.tools.length}</span>
                <span className="tools-stat-lbl">Agent Functions</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="tools-tabs" aria-label="Explorer tabs">
              <button
                type="button"
                className={`tools-tab${tab === 'tools' ? ' is-active' : ''}`}
                onClick={() => setTab('tools')}
              >
                🛠️ Agent Tools ({data.tools.length})
              </button>
              <button
                type="button"
                className={`tools-tab${tab === 'companies' ? ' is-active' : ''}`}
                onClick={() => setTab('companies')}
              >
                🏢 Company Directory ({data.companies.length})
              </button>
              <button
                type="button"
                className={`tools-tab${tab === 'orders' ? ' is-active' : ''}`}
                onClick={() => setTab('orders')}
              >
                📦 Sample Orders ({data.summary.totalOrders})
              </button>
              <button
                type="button"
                className={`tools-tab${tab === 'tester' ? ' is-active' : ''}`}
                onClick={() => setTab('tester')}
              >
                ⚡ Live Tool Tester
              </button>
            </nav>

            {/* Tab 1: Agent Tools */}
            {tab === 'tools' && (
              <div className="tools-grid">
                {data.tools.map(tool => (
                  <article key={tool.name} className="tool-card">
                    <div className="tool-card-head">
                      <div>
                        <h3 className="tool-card-title">{tool.name}</h3>
                        <span className="tool-card-returns">{tool.returns}</span>
                      </div>
                      <button
                        type="button"
                        className="tool-run-btn"
                        onClick={() => selectToolForTester(tool)}
                      >
                        Try in Tester →
                      </button>
                    </div>
                    <p className="tool-card-desc">{tool.description}</p>
                    <div className="tool-card-params">
                      <strong>Parameters:</strong>
                      <ul>
                        {Object.entries(tool.parameters).map(([param, desc]) => (
                          <li key={param}>
                            <code>{param}</code>: {desc}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Tab 2: Companies */}
            {tab === 'companies' && (
              <div className="tools-companies-view">
                <div className="tools-filter-bar">
                  <input
                    type="search"
                    placeholder="Search company, industry, or tier..."
                    value={companySearch}
                    onChange={e => setCompanySearch(e.target.value)}
                    className="tools-search-input"
                  />
                  <div className="tools-region-filters">
                    {['All', ...data.summary.regions].map(reg => (
                      <button
                        key={reg}
                        type="button"
                        className={`tools-chip-btn${companyRegion === reg ? ' is-active' : ''}`}
                        onClick={() => setCompanyRegion(reg)}
                      >
                        {reg}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tools-table-container">
                  <table className="tools-table">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Tier</th>
                        <th>Industry</th>
                        <th>HQ</th>
                        <th>Region</th>
                        <th style={{textAlign: 'right'}}>Total Spend</th>
                        <th style={{textAlign: 'right'}}>Orders</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCompanies.map(c => (
                        <tr
                          key={c.name}
                          className={selectedCompany === c.name ? 'is-selected-row' : ''}
                        >
                          <td>
                            <strong>{c.name}</strong>
                          </td>
                          <td>
                            <span
                              className={`tier-badge tier-${(c.tier || 'Standard').toLowerCase()}`}
                            >
                              {c.tier || 'Standard'}
                            </span>
                          </td>
                          <td>{c.industry || '—'}</td>
                          <td>{c.hq || '—'}</td>
                          <td>{c.region}</td>
                          <td style={{textAlign: 'right'}}>
                            ${Math.round(c.totalSpend).toLocaleString()}
                          </td>
                          <td style={{textAlign: 'right'}}>{c.orderCount}</td>
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => inspectCompany(c.name)}
                            >
                              Inspect Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Company Details Modal / Panel */}
                {selectedCompany && (
                  <div className="tools-detail-box">
                    <div className="tools-detail-head">
                      <h3>Company Profile: {selectedCompany}</h3>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedCompany(null)}
                      >
                        Close
                      </button>
                    </div>
                    {loadingDetails ? (
                      <p>Loading company order history...</p>
                    ) : companyDetails ? (
                      <div className="tools-detail-content">
                        <div className="tools-detail-grid">
                          <div>
                            <strong>Industry:</strong> {companyDetails.industry}
                          </div>
                          <div>
                            <strong>HQ:</strong> {companyDetails.hq}
                          </div>
                          <div>
                            <strong>Account Tier:</strong> {companyDetails.tier}
                          </div>
                          <div>
                            <strong>Region:</strong> {companyDetails.region}
                          </div>
                          <div>
                            <strong>Total Spend:</strong> $
                            {Math.round(companyDetails.totalSpend).toLocaleString()}
                          </div>
                          <div>
                            <strong>Top Products:</strong> {companyDetails.topProducts?.join(', ')}
                          </div>
                        </div>
                        <h4 style={{marginTop: 'var(--s-3)'}}>
                          Order History ({companyDetails.orders?.length} orders)
                        </h4>
                        <div className="tools-subtable-container">
                          <table className="tools-table tools-subtable">
                            <thead>
                              <tr>
                                <th>Order ID</th>
                                <th>Date</th>
                                <th>Product</th>
                                <th style={{textAlign: 'right'}}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {companyDetails.orders?.map((ord: any) => (
                                <tr key={ord.id}>
                                  <td>
                                    <code>{ord.id}</code>
                                  </td>
                                  <td>{ord.date}</td>
                                  <td>{ord.product}</td>
                                  <td style={{textAlign: 'right'}}>
                                    ${Math.round(ord.amount).toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <p>No details found.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Orders */}
            {tab === 'orders' && (
              <div className="tools-orders-view">
                <div className="tools-filter-bar">
                  <input
                    type="search"
                    placeholder="Search by customer, product, or order ID..."
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    className="tools-search-input"
                  />
                  <div className="tools-region-filters">
                    {['All', ...data.summary.regions].map(reg => (
                      <button
                        key={reg}
                        type="button"
                        className={`tools-chip-btn${orderRegion === reg ? ' is-active' : ''}`}
                        onClick={() => setOrderRegion(reg)}
                      >
                        {reg}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tools-table-container">
                  <table className="tools-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th>Region</th>
                        <th>Product</th>
                        <th style={{textAlign: 'right'}}>Amount</th>
                        <th>Line Items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.slice(0, 50).map(o => (
                        <tr key={o.id}>
                          <td>
                            <code>{o.id}</code>
                          </td>
                          <td>
                            <strong>{o.customer}</strong>
                          </td>
                          <td>{o.date}</td>
                          <td>{o.region}</td>
                          <td>{o.product}</td>
                          <td style={{textAlign: 'right'}}>
                            ${Math.round(o.amount).toLocaleString()}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => inspectOrder(o.id)}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="tools-table-note">
                  Showing top {Math.min(50, filteredOrders.length)} matching orders of{' '}
                  {data.summary.totalOrders} total.
                </p>

                {/* Order Details View */}
                {selectedOrder && (
                  <div className="tools-detail-box">
                    <div className="tools-detail-head">
                      <h3>
                        Order #{selectedOrder.id}: {selectedOrder.customer}
                      </h3>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedOrder(null)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="tools-detail-grid">
                      <div>
                        <strong>Date:</strong> {selectedOrder.date}
                      </div>
                      <div>
                        <strong>Region:</strong> {selectedOrder.region}
                      </div>
                      <div>
                        <strong>Carrier:</strong> {selectedOrder.shippingCarrier}
                      </div>
                      <div>
                        <strong>Tracking:</strong> <code>{selectedOrder.trackingNumber}</code>
                      </div>
                      <div>
                        <strong>Status:</strong>{' '}
                        <span className="tier-badge tier-growth">
                          {selectedOrder.deliveryStatus}
                        </span>
                      </div>
                      <div>
                        <strong>Total Amount:</strong> $
                        {Math.round(selectedOrder.amount).toLocaleString()}
                      </div>
                    </div>
                    <h4 style={{marginTop: 'var(--s-3)'}}>Line Items</h4>
                    <ul>
                      {selectedOrder.lineItems?.map((item: any, idx: number) => (
                        <li key={idx}>
                          {item.item} — {item.quantity}x @ ${item.unitPrice} (${item.total})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Live Tool Tester */}
            {tab === 'tester' && (
              <div className="tools-tester-view">
                <div className="tools-tester-controls">
                  <div className="tools-tester-field">
                    <label htmlFor="tool-select">Select Function to Execute:</label>
                    <select
                      id="tool-select"
                      value={testerTool}
                      onChange={e => {
                        const nextTool = e.target.value;
                        setTesterTool(nextTool);
                        const found = data.tools.find(t => t.name === nextTool);
                        if (found) {
                          setTesterArgs(JSON.stringify(found.sampleArgs, null, 2));
                        }
                        setTesterOutput(null);
                      }}
                      className="tools-select"
                    >
                      {data.tools.map(t => (
                        <option key={t.name} value={t.name}>
                          {t.name} ({t.returns})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="tools-tester-field">
                    <label htmlFor="tool-args">JSON Arguments:</label>
                    <textarea
                      id="tool-args"
                      rows={6}
                      value={testerArgs}
                      onChange={e => setTesterArgs(e.target.value)}
                      className="tools-textarea"
                    />
                  </div>

                  <button
                    type="button"
                    className="tools-execute-btn"
                    disabled={testerRunning}
                    onClick={runTester}
                  >
                    {testerRunning ? 'Executing call…' : 'Execute Function Call ⚡'}
                  </button>
                </div>

                <div className="tools-tester-output">
                  <div className="tools-tester-output-head">
                    <span>Response Output</span>
                    {testerDuration !== null && <span>Duration: {testerDuration}ms</span>}
                  </div>
                  <pre className="tools-pre">
                    {testerOutput ||
                      '// Click "Execute Function Call" to run the agent tool and inspect response payload.'}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
