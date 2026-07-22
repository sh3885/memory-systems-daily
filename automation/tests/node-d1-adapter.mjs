import { DatabaseSync } from "node:sqlite";

class NodeD1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new NodeD1Statement(this.database, this.sql, parameters);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
      results: [],
    };
  }
}

export class NodeD1Database {
  constructor(schema) {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(schema);
  }

  prepare(sql) {
    return new NodeD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  close() {
    this.database.close();
  }
}

