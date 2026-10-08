-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "spare_part_id" UUID;

-- CreateTable
CREATE TABLE "spare_parts" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "specs" JSON NOT NULL DEFAULT '{}',
    "images" JSONB NOT NULL DEFAULT '[]',
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "price_centavos" INTEGER,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_part_compatibility" (
    "spare_part_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "spare_part_compatibility_pkey" PRIMARY KEY ("spare_part_id","product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spare_parts_slug_key" ON "spare_parts"("slug");

-- CreateIndex
CREATE INDEX "spare_parts_category_idx" ON "spare_parts"("category");

-- AddForeignKey
ALTER TABLE "spare_part_compatibility" ADD CONSTRAINT "spare_part_compatibility_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_part_compatibility" ADD CONSTRAINT "spare_part_compatibility_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
