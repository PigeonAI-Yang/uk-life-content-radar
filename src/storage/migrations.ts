export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE fts_probe USING fts5(content);
      INSERT INTO fts_probe(content) VALUES ('fts5 probe ready');
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        positioning TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT '',
        forbidden_expressions TEXT NOT NULL DEFAULT '[]',
        platform_identities TEXT NOT NULL DEFAULT '{}',
        default_templates TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE idempotency_records (
        caller TEXT NOT NULL,
        command TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (caller, command, idempotency_key)
      );
    `
  },
  {
    version: 3,
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted')),
        progress INTEGER NOT NULL,
        parameters_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        temporary_result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX tasks_status_updated ON tasks(status, updated_at DESC, id);
    `
  },
  {
    version: 4,
    sql: `
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
        status TEXT NOT NULL, file_path TEXT NOT NULL, byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, file_mtime TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE assets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE asset_versions (
        id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), version INTEGER NOT NULL,
        file_path TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, file_mtime TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(asset_id, version)
      );
      CREATE TABLE content_projects (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), title TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE content_versions (
        id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content_projects(id), version INTEGER NOT NULL,
        platform TEXT, parent_id TEXT, body TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(content_id, version, platform)
      );
      CREATE TABLE content_source_refs (
        content_id TEXT NOT NULL REFERENCES content_projects(id), source_id TEXT NOT NULL REFERENCES sources(id),
        PRIMARY KEY(content_id, source_id)
      );
      CREATE TABLE content_asset_refs (
        content_id TEXT NOT NULL REFERENCES content_projects(id), asset_version_id TEXT NOT NULL REFERENCES asset_versions(id),
        image_order INTEGER NOT NULL, PRIMARY KEY(content_id, asset_version_id)
      );
    `
  },
  {
    version: 5,
    sql: `
      CREATE TABLE package_candidates (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        content_id TEXT NOT NULL REFERENCES content_projects(id), content_version_id TEXT NOT NULL REFERENCES content_versions(id),
        platform TEXT NOT NULL, template_version TEXT NOT NULL, asset_version_ids TEXT NOT NULL,
        fingerprint TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE approval_requests (
        candidate_id TEXT PRIMARY KEY REFERENCES package_candidates(id), fingerprint TEXT NOT NULL,
        status TEXT NOT NULL, requested_at TEXT NOT NULL
      );
      CREATE TABLE approvals (
        candidate_id TEXT PRIMARY KEY REFERENCES package_candidates(id), fingerprint TEXT NOT NULL,
        approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
      );
      CREATE TABLE packages (
        id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES package_candidates(id),
        account_id TEXT NOT NULL REFERENCES accounts(id), platform TEXT NOT NULL, directory_path TEXT NOT NULL,
        manifest_path TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE package_files (
        package_id TEXT NOT NULL REFERENCES packages(id), relative_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL,
        PRIMARY KEY(package_id, relative_path)
      );
    `
  },
  {
    version: 6,
    sql: `
      ALTER TABLE sources ADD COLUMN canonical_url TEXT;
      CREATE UNIQUE INDEX sources_canonical_url ON sources(canonical_url) WHERE canonical_url IS NOT NULL;
      CREATE TABLE source_snapshots (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), tab_id TEXT NOT NULL,
        kind TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, context TEXT NOT NULL,
        file_path TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE browser_tabs (
        id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
        error TEXT, updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 7,
    sql: `
      CREATE TABLE source_versions (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), version INTEGER NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, file_path TEXT NOT NULL, byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, file_mtime TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(source_id, version)
      );
      INSERT INTO source_versions
      SELECT lower(hex(randomblob(16))), id, version, title, body, file_path, byte_size, sha256, file_mtime, created_at FROM sources;
      CREATE TABLE excerpts (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), text TEXT NOT NULL,
        context TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, body TEXT NOT NULL, source_id TEXT REFERENCES sources(id),
        content_id TEXT REFERENCES content_projects(id), version INTEGER NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE content_excerpt_refs (
        content_id TEXT NOT NULL REFERENCES content_projects(id), excerpt_id TEXT NOT NULL REFERENCES excerpts(id),
        PRIMARY KEY(content_id, excerpt_id)
      );
      CREATE TABLE content_note_refs (
        content_id TEXT NOT NULL REFERENCES content_projects(id), note_id TEXT NOT NULL REFERENCES notes(id),
        PRIMARY KEY(content_id, note_id)
      );
    `
  },
  {
    version: 8,
    sql: `
      ALTER TABLE sources ADD COLUMN topic TEXT NOT NULL DEFAULT '';
      ALTER TABLE sources ADD COLUMN region TEXT NOT NULL DEFAULT '';
      ALTER TABLE sources ADD COLUMN target_audience TEXT NOT NULL DEFAULT '';
      ALTER TABLE sources ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE excerpts ADD COLUMN topic TEXT NOT NULL DEFAULT '';
      ALTER TABLE excerpts ADD COLUMN region TEXT NOT NULL DEFAULT '';
      ALTER TABLE excerpts ADD COLUMN target_audience TEXT NOT NULL DEFAULT '';
      ALTER TABLE excerpts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE notes ADD COLUMN topic TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN region TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN target_audience TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

      CREATE VIRTUAL TABLE search_fts USING fts5(
        object_type UNINDEXED, object_id UNINDEXED, title, body, source, tags,
        topic UNINDEXED, region UNINDEXED, target_audience UNINDEXED,
        status UNINDEXED, updated_at UNINDEXED
      );
      INSERT INTO search_fts
      SELECT 'resource', id, title, body, COALESCE(canonical_url, ''), tags, topic, region, target_audience, status, updated_at FROM sources;
      INSERT INTO search_fts
      SELECT 'excerpt', e.id, s.title, e.text || ' ' || e.context, COALESCE(s.canonical_url, s.id), e.tags,
        e.topic, e.region, e.target_audience, e.status, e.updated_at FROM excerpts e JOIN sources s ON s.id=e.source_id;
      INSERT INTO search_fts
      SELECT 'note', n.id, '笔记', n.body, COALESCE(s.canonical_url, n.source_id, ''), n.tags,
        n.topic, n.region, n.target_audience, n.status, n.updated_at FROM notes n LEFT JOIN sources s ON s.id=n.source_id;

      CREATE TRIGGER search_sources_insert AFTER INSERT ON sources BEGIN
        INSERT INTO search_fts VALUES ('resource', new.id, new.title, new.body, COALESCE(new.canonical_url, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at);
      END;
      CREATE TRIGGER search_sources_update AFTER UPDATE ON sources BEGIN
        DELETE FROM search_fts WHERE object_type='resource' AND object_id=old.id;
        INSERT INTO search_fts VALUES ('resource', new.id, new.title, new.body, COALESCE(new.canonical_url, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at);
      END;
      CREATE TRIGGER search_excerpts_insert AFTER INSERT ON excerpts BEGIN
        INSERT INTO search_fts VALUES ('excerpt', new.id, (SELECT title FROM sources WHERE id=new.source_id), new.text || ' ' || new.context,
          COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at);
      END;
      CREATE TRIGGER search_excerpts_update AFTER UPDATE ON excerpts BEGIN
        DELETE FROM search_fts WHERE object_type='excerpt' AND object_id=old.id;
        INSERT INTO search_fts VALUES ('excerpt', new.id, (SELECT title FROM sources WHERE id=new.source_id), new.text || ' ' || new.context,
          COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at);
      END;
      CREATE TRIGGER search_notes_insert AFTER INSERT ON notes BEGIN
        INSERT INTO search_fts VALUES ('note', new.id, '笔记', new.body,
          COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at);
      END;
      CREATE TRIGGER search_notes_update AFTER UPDATE ON notes BEGIN
        DELETE FROM search_fts WHERE object_type='note' AND object_id=old.id;
        INSERT INTO search_fts VALUES ('note', new.id, '笔记', new.body,
          COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at);
      END;

      CREATE TABLE saved_views (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL,
        filters_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX saved_views_scope_name ON saved_views(scope, name, id);
    `
  },
  {
    version: 9,
    sql: `
      ALTER TABLE content_versions ADD COLUMN outline TEXT NOT NULL DEFAULT '';
      ALTER TABLE content_versions ADD COLUMN verification_state TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE content_versions ADD COLUMN edit_state TEXT NOT NULL DEFAULT 'generated';
      ALTER TABLE content_versions ADD COLUMN file_path TEXT;
      ALTER TABLE content_versions ADD COLUMN byte_size INTEGER;
      ALTER TABLE content_versions ADD COLUMN file_sha256 TEXT;
      ALTER TABLE content_versions ADD COLUMN file_mtime TEXT;
    `
  },
  {
    version: 10,
    sql: `
      ALTER TABLE asset_versions ADD COLUMN operation TEXT NOT NULL DEFAULT 'import';
      ALTER TABLE asset_versions ADD COLUMN parent_version_id TEXT;
      ALTER TABLE asset_versions ADD COLUMN width INTEGER;
      ALTER TABLE asset_versions ADD COLUMN height INTEGER;
      CREATE TABLE asset_operations (
        id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id),
        source_version_id TEXT NOT NULL REFERENCES asset_versions(id),
        output_version_id TEXT, operation TEXT NOT NULL,
        parameters_json TEXT NOT NULL, status TEXT NOT NULL,
        error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX asset_operations_asset_created ON asset_operations(asset_id, created_at DESC, id);
    `
  },
  {
    version: 11,
    sql: `
      CREATE TABLE account_versions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        version INTEGER NOT NULL, config_json TEXT NOT NULL,
        file_path TEXT NOT NULL, byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, file_mtime TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(account_id, version)
      );
    `
  },
  {
    version: 12,
    sql: `
      CREATE TABLE storage_scans (
        id TEXT PRIMARY KEY, file_count INTEGER NOT NULL, byte_size INTEGER NOT NULL,
        growth_files INTEGER NOT NULL, growth_bytes INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL, free_bytes INTEGER NOT NULL,
        counts_json TEXT NOT NULL, scanned_at TEXT NOT NULL
      );
    `
  },
  {
    version: 13,
    sql: `
      DROP TRIGGER search_sources_insert;
      DROP TRIGGER search_sources_update;
      DROP TRIGGER search_excerpts_insert;
      DROP TRIGGER search_excerpts_update;
      DROP TRIGGER search_notes_insert;
      DROP TRIGGER search_notes_update;
      DROP TABLE search_fts;
      CREATE VIRTUAL TABLE search_fts USING fts5(
        object_type UNINDEXED, object_id UNINDEXED, title, body, source, tags,
        topic UNINDEXED, region UNINDEXED, target_audience UNINDEXED,
        status UNINDEXED, updated_at UNINDEXED, account_id UNINDEXED, platform UNINDEXED
      );
      INSERT INTO search_fts SELECT 'resource', id, title, body, COALESCE(canonical_url, ''), tags, topic, region, target_audience, status, updated_at, '', '' FROM sources;
      INSERT INTO search_fts SELECT 'excerpt', e.id, s.title, e.text || ' ' || e.context, COALESCE(s.canonical_url, s.id), e.tags, e.topic, e.region, e.target_audience, e.status, e.updated_at, '', '' FROM excerpts e JOIN sources s ON s.id=e.source_id;
      INSERT INTO search_fts SELECT 'note', n.id, '笔记', n.body, COALESCE(s.canonical_url, n.source_id, ''), n.tags, n.topic, n.region, n.target_audience, n.status, n.updated_at, COALESCE(p.account_id, ''), '' FROM notes n LEFT JOIN sources s ON s.id=n.source_id LEFT JOIN content_projects p ON p.id=n.content_id;
      INSERT INTO search_fts SELECT 'content', v.id, p.title, v.body, '', '[]', '', '', '', p.status, v.created_at, p.account_id, COALESCE(v.platform, '') FROM content_versions v JOIN content_projects p ON p.id=v.content_id;
      INSERT INTO search_fts SELECT 'asset', a.id, a.name, a.name, '', '[]', '', '', '', a.status, a.updated_at, '', '' FROM assets a;
      INSERT INTO search_fts SELECT 'package', k.id, p.title, p.title, k.manifest_path, '[]', '', '', '', k.status, k.created_at, k.account_id, k.platform FROM packages k JOIN package_candidates c ON c.id=k.candidate_id JOIN content_projects p ON p.id=c.content_id;
      INSERT INTO search_fts SELECT 'account', id, name, positioning || ' ' || audience || ' ' || tone || ' ' || forbidden_expressions, '', '[]', '', '', audience, status, updated_at, id, platform_identities FROM accounts;
      CREATE TRIGGER search_sources_insert AFTER INSERT ON sources BEGIN INSERT INTO search_fts VALUES ('resource', new.id, new.title, new.body, COALESCE(new.canonical_url, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at, '', ''); END;
      CREATE TRIGGER search_sources_update AFTER UPDATE ON sources BEGIN DELETE FROM search_fts WHERE object_type='resource' AND object_id=old.id; DELETE FROM semantic_vectors WHERE object_type='resource' AND object_id=old.id; INSERT INTO search_fts VALUES ('resource', new.id, new.title, new.body, COALESCE(new.canonical_url, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at, '', ''); END;
      CREATE TRIGGER search_excerpts_insert AFTER INSERT ON excerpts BEGIN INSERT INTO search_fts VALUES ('excerpt', new.id, (SELECT title FROM sources WHERE id=new.source_id), new.text || ' ' || new.context, COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at, '', ''); END;
      CREATE TRIGGER search_excerpts_update AFTER UPDATE ON excerpts BEGIN DELETE FROM search_fts WHERE object_type='excerpt' AND object_id=old.id; DELETE FROM semantic_vectors WHERE object_type='excerpt' AND object_id=old.id; INSERT INTO search_fts VALUES ('excerpt', new.id, (SELECT title FROM sources WHERE id=new.source_id), new.text || ' ' || new.context, COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at, '', ''); END;
      CREATE TRIGGER search_notes_insert AFTER INSERT ON notes BEGIN INSERT INTO search_fts VALUES ('note', new.id, '笔记', new.body, COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at, COALESCE((SELECT account_id FROM content_projects WHERE id=new.content_id), ''), ''); END;
      CREATE TRIGGER search_notes_update AFTER UPDATE ON notes BEGIN DELETE FROM search_fts WHERE object_type='note' AND object_id=old.id; DELETE FROM semantic_vectors WHERE object_type='note' AND object_id=old.id; INSERT INTO search_fts VALUES ('note', new.id, '笔记', new.body, COALESCE((SELECT canonical_url FROM sources WHERE id=new.source_id), new.source_id, ''), new.tags, new.topic, new.region, new.target_audience, new.status, new.updated_at, COALESCE((SELECT account_id FROM content_projects WHERE id=new.content_id), ''), ''); END;
      CREATE TRIGGER search_content_versions_insert AFTER INSERT ON content_versions BEGIN INSERT INTO search_fts SELECT 'content', new.id, p.title, new.body, '', '[]', '', '', '', p.status, new.created_at, p.account_id, COALESCE(new.platform, '') FROM content_projects p WHERE p.id=new.content_id; END;
      CREATE TRIGGER search_assets_insert AFTER INSERT ON assets BEGIN INSERT INTO search_fts VALUES ('asset', new.id, new.name, new.name, '', '[]', '', '', '', new.status, new.updated_at, '', ''); END;
      CREATE TRIGGER search_assets_update AFTER UPDATE ON assets BEGIN DELETE FROM search_fts WHERE object_type='asset' AND object_id=old.id; DELETE FROM semantic_vectors WHERE object_type='asset' AND object_id=old.id; INSERT INTO search_fts VALUES ('asset', new.id, new.name, new.name, '', '[]', '', '', '', new.status, new.updated_at, '', ''); END;
      CREATE TRIGGER search_packages_insert AFTER INSERT ON packages BEGIN INSERT INTO search_fts SELECT 'package', new.id, p.title, p.title, new.manifest_path, '[]', '', '', '', new.status, new.created_at, new.account_id, new.platform FROM package_candidates c JOIN content_projects p ON p.id=c.content_id WHERE c.id=new.candidate_id; END;
      CREATE TRIGGER search_accounts_insert AFTER INSERT ON accounts BEGIN INSERT INTO search_fts VALUES ('account', new.id, new.name, new.positioning || ' ' || new.audience || ' ' || new.tone || ' ' || new.forbidden_expressions, '', '[]', '', '', new.audience, new.status, new.updated_at, new.id, new.platform_identities); END;
      CREATE TRIGGER search_accounts_update AFTER UPDATE ON accounts BEGIN DELETE FROM search_fts WHERE object_type='account' AND object_id=old.id; DELETE FROM semantic_vectors WHERE object_type='account' AND object_id=old.id; INSERT INTO search_fts VALUES ('account', new.id, new.name, new.positioning || ' ' || new.audience || ' ' || new.tone || ' ' || new.forbidden_expressions, '', '[]', '', '', new.audience, new.status, new.updated_at, new.id, new.platform_identities); END;
      CREATE TABLE semantic_models (
        id TEXT PRIMARY KEY, algorithm TEXT NOT NULL, dimensions INTEGER NOT NULL,
        license TEXT NOT NULL, byte_size INTEGER NOT NULL, package_increment_bytes INTEGER NOT NULL
      );
      INSERT INTO semantic_models VALUES ('local-char-ngram-v1', 'normalized signed character 1-3 gram hashing', 128, 'MIT project-owned implementation', 0, 0);
      CREATE TABLE semantic_vectors (
        object_type TEXT NOT NULL, object_id TEXT NOT NULL, model_id TEXT NOT NULL,
        text_sha256 TEXT NOT NULL, embedding BLOB NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(object_type, object_id, model_id)
      );
      CREATE INDEX semantic_vectors_model_type ON semantic_vectors(model_id, object_type, object_id);
    `
  },
  {
    version: 14,
    sql: `
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL,
        target_customer TEXT NOT NULL,
        problem TEXT NOT NULL,
        price_range TEXT NOT NULL,
        service_scope TEXT NOT NULL,
        suitable_for TEXT NOT NULL,
        unsuitable_for TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX products_account_updated ON products(account_id, updated_at DESC, id);

      CREATE TABLE product_versions (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        file_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        file_mtime TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(product_id, version)
      );

      CREATE TABLE strategy_proposals (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        product_id TEXT REFERENCES products(id),
        proposal_type TEXT NOT NULL,
        proposed_json TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        success_measure TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        approved_strategy_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX strategy_proposals_status_updated
        ON strategy_proposals(status, updated_at DESC, id);

      CREATE TABLE strategy_versions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        product_id TEXT REFERENCES products(id),
        proposal_id TEXT NOT NULL UNIQUE REFERENCES strategy_proposals(id),
        version INTEGER NOT NULL,
        strategy_json TEXT NOT NULL,
        file_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        file_mtime TEXT NOT NULL,
        status TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        invalidated_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX strategy_versions_account_status
        ON strategy_versions(account_id, status, version DESC, id);

      CREATE TABLE leads (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        product_id TEXT REFERENCES products(id),
        source_content_id TEXT REFERENCES content_projects(id),
        platform TEXT NOT NULL,
        nickname TEXT NOT NULL,
        first_contact_at TEXT NOT NULL,
        stage TEXT NOT NULL CHECK(stage IN (
          'new_message', 'need_understood', 'wechat_added', 'negotiating', 'won', 'lost'
        )),
        core_need TEXT NOT NULL,
        intent TEXT NOT NULL,
        wechat_added INTEGER NOT NULL CHECK(wechat_added IN (0, 1)),
        next_action TEXT NOT NULL,
        next_follow_up_at TEXT,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX leads_stage_follow_up
        ON leads(stage, next_follow_up_at, updated_at DESC, id);
      CREATE INDEX leads_content_updated
        ON leads(source_content_id, updated_at DESC, id);

      CREATE TABLE conversation_records (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id),
        channel TEXT NOT NULL CHECK(channel IN ('xiaohongshu', 'wechat', 'spoken', 'other')),
        occurred_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        needs_json TEXT NOT NULL,
        objections_json TEXT NOT NULL,
        suggested_reply TEXT NOT NULL,
        conclusion TEXT NOT NULL,
        next_follow_up_at TEXT,
        confirmation_status TEXT NOT NULL CHECK(confirmation_status IN ('pending', 'confirmed')),
        file_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        file_mtime TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX conversation_records_lead_occurred
        ON conversation_records(lead_id, occurred_at DESC, id);

      CREATE TABLE deals (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        outcome TEXT NOT NULL CHECK(outcome IN ('won', 'lost')),
        amount_minor INTEGER,
        currency TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        content_insight TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX deals_decided ON deals(decided_at DESC, id);

      CREATE TABLE post_metrics (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL REFERENCES content_projects(id),
        platform TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('manual', 'screenshot', 'import')),
        impressions INTEGER,
        views INTEGER,
        likes INTEGER,
        saves INTEGER,
        comments INTEGER,
        messages INTEGER,
        evidence_file_path TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX post_metrics_content_observed
        ON post_metrics(content_id, observed_at DESC, id);

      CREATE TABLE intelligence_candidates (
        id TEXT PRIMARY KEY,
        source_id TEXT REFERENCES sources(id),
        scan_task_id TEXT REFERENCES tasks(id),
        title TEXT NOT NULL,
        source_url TEXT NOT NULL,
        audience TEXT NOT NULL,
        impact TEXT NOT NULL,
        timeliness TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        duplicate_of_id TEXT REFERENCES intelligence_candidates(id),
        angles_json TEXT NOT NULL,
        publish_before TEXT,
        status TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX intelligence_candidates_status_deadline
        ON intelligence_candidates(status, publish_before, updated_at DESC, id);
    `
  },
  {
    version: 15,
    sql: `
      ALTER TABLE intelligence_candidates ADD COLUMN promoted_resource_id TEXT REFERENCES sources(id);
      ALTER TABLE intelligence_candidates ADD COLUMN promoted_content_id TEXT REFERENCES content_projects(id);
      CREATE TABLE intelligence_scan_sources (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        source_name TEXT NOT NULL,
        source_id TEXT REFERENCES sources(id),
        status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed')),
        item_count INTEGER NOT NULL,
        error TEXT,
        last_success_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX intelligence_scan_sources_task ON intelligence_scan_sources(task_id, source_name);
    `
  }
] as const;
