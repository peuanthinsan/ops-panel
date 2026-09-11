import pg from 'pg';

export function localPostgres(connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Local database adapter requires loopback');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000, options: '-c timezone=UTC' });
  pool.on('error', error => console.error(JSON.stringify({ event: 'ops_database_pool_error', code: error.code || 'UNKNOWN' })));
  class Query {
    constructor(text, values) { this.text = text; this.values = values; this.promise = null; }
    then(resolve, reject) { this.promise ||= pool.query(this.text, this.values).then(result => result.rows); return this.promise.then(resolve, reject); }
  }
  function sql(strings, ...values) {
    if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw')) throw new TypeError('Use tagged SQL or sql.query');
    return new Query(strings.reduce((text, part, index) => text + (index ? '$' + index : '') + part, ''), values);
  }
  sql.query = (text, values = []) => new Query(text, values);
  sql.transaction = async (queries, options = {}) => {
    if (typeof queries === 'function') queries = queries(sql);
    if (!Array.isArray(queries) || queries.some(query => !(query instanceof Query) || query.promise)) throw new Error('Transaction requires unexecuted queries');
    const client = await pool.connect();
    try {
      let begin = 'BEGIN';
      if (options.isolationLevel) {
        const levels = { ReadUncommitted: 'READ UNCOMMITTED', ReadCommitted: 'READ COMMITTED', RepeatableRead: 'REPEATABLE READ', Serializable: 'SERIALIZABLE' };
        if (!levels[options.isolationLevel]) throw new Error('Unsupported isolation level');
        begin += ' ISOLATION LEVEL ' + levels[options.isolationLevel];
      }
      if (options.readOnly) begin += ' READ ONLY';
      await client.query(begin);
      const results = [];
      for (const query of queries) results.push((await client.query(query.text, query.values)).rows);
      const committed = await client.query('COMMIT');
      if (committed.command !== 'COMMIT') throw new Error('Database transaction did not commit');
      return results;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  };
  sql.close = () => pool.end();
  return sql;
}
