"""Link reviewed drafts and recorded sets to exercise sessions."""
import sqlalchemy as sa
from alembic import op

revision = "b2d0df449113"
down_revision = "4d294f5eb102"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("exercise_sessions") as batch:
        batch.add_column(sa.Column("plan_id", sa.String(36)))
        batch.create_foreign_key("fk_session_plan", "crew_records", ["plan_id"], ["id"])
        batch.add_column(sa.Column("sets_json", sa.JSON))


def downgrade():
    with op.batch_alter_table("exercise_sessions") as batch:
        batch.drop_constraint("fk_session_plan", type_="foreignkey")
        batch.drop_column("plan_id")
        batch.drop_column("sets_json")
