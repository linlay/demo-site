-- Site-wide active AWCP exposure, independent from demo workspace resets.
CREATE TABLE awcp_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active_enabled INTEGER NOT NULL CHECK (active_enabled IN (0, 1)),
    version INTEGER NOT NULL CHECK (version > 0)
);
INSERT INTO awcp_settings(id, active_enabled, version) VALUES(1, 0, 1);
