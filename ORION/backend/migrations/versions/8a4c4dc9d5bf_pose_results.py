"""Add optional pose session metadata and assessment results."""

import sqlalchemy as sa
from alembic import op

revision = "8a4c4dc9d5bf"
down_revision = "63742b726502"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("exercise_sessions", sa.Column("pose_engine", sa.String(16)))
    op.add_column("exercise_sessions", sa.Column("tracked_side", sa.String(5)))
    op.add_column("exercise_sessions", sa.Column("assessment_json", sa.JSON))


def downgrade():
    with op.batch_alter_table("exercise_sessions") as batch:
        batch.drop_column("assessment_json")
        batch.drop_column("tracked_side")
        batch.drop_column("pose_engine")
