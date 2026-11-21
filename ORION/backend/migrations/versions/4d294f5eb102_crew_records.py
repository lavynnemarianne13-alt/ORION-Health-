"""Persist anthropometry and workout drafts per athlete."""
import sqlalchemy as sa
from alembic import op

revision = "4d294f5eb102"
down_revision = "8a4c4dc9d5bf"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "crew_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("athlete_id", sa.String(36), sa.ForeignKey("athletes.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
    )
    op.create_index("ix_crew_records_athlete_id", "crew_records", ["athlete_id"])


def downgrade():
    op.drop_table("crew_records")
