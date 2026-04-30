INSERT OR IGNORE INTO "Tag" ("id", "userId", "name")
SELECT lower(hex(randomblob(16))), "id", 'gen:bigger'
FROM "User";

INSERT OR IGNORE INTO "Tag" ("id", "userId", "name")
SELECT lower(hex(randomblob(16))), "id", 'gen:meaning'
FROM "User";
