from datetime import datetime

from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from db import Base

SAVINGS_LABEL = "megtakarítás"


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, index=True)
    tx_type = Column(String, nullable=True)          # B oszlop: tranzakció típusa
    description = Column(String, nullable=True)      # C oszlop: közlemény
    amount = Column(Float, nullable=False)           # D oszlop: összeg
    main_category = Column(String, nullable=True, index=True)  # fő attribútum
    category_source = Column(String, nullable=False, default="none")  # auto | manual | none
    tx_hash = Column(String, unique=True, index=True, nullable=False)
    # Soft delete: törléskor False-ra állítjuk, a rekord a hash-ütközés-ellenőrzés
    # miatt megmarad az adatbázisban, hogy egy újrafeltöltés ne hozza vissza.
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    attributes = relationship(
        "Attribute",
        back_populates="transaction",
        cascade="all, delete-orphan",
    )

    @property
    def kind(self):
        """bevétel / kiadás / megtakarítás — utóbbi akkor, ha a fő attribútum
        (bármilyen előjelű összeg esetén) 'megtakarítás', ekkor az összeg sem
        bevételként, sem kiadásként nem számít, csak az egyenleget módosítja."""
        if (self.main_category or "").strip().lower() == SAVINGS_LABEL:
            return "megtakarítás"
        return "bevétel" if self.amount >= 0 else "kiadás"


class Attribute(Base):
    """Al-attribútum fa-csomópont. parent_id=NULL -> első szintű al-attribútum
    a tranzakció fő attribútuma alatt; egyébként tetszőleges mélységű lánc."""

    __tablename__ = "attributes"

    id = Column(Integer, primary_key=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("attributes.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transaction = relationship("Transaction", back_populates="attributes")
    parent = relationship("Attribute", remote_side=[id], backref="children")
