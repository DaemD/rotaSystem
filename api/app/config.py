from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Railway gives postgres://... — SQLAlchemy+psycopg2 needs postgresql+psycopg2://..."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg2" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://rota:rota@localhost:5433/rota"
    secret_key: str = "dev-secret-key-change-in-prod"
    access_token_expire_minutes: int = 480
    algorithm: str = "HS256"
    # Railway injects PORT
    port: int = 8000

    def sqlalchemy_url(self) -> str:
        return normalize_database_url(self.database_url)


settings = Settings()
