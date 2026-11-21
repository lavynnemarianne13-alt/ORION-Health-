import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL

database_path = Path(os.environ.get("ORION_DB_PATH", Path(__file__).with_name("orion.db"))).resolve()
database_url = URL.create("sqlite", database=str(database_path))
engine = create_engine(database_url)
@event.listens_for(engine, "connect")
def enable_foreign_keys(connection, _connection_record):
    connection.execute("PRAGMA foreign_keys = ON")