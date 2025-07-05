import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReferenceTextToNotes1734248000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'notes',
      new TableColumn({
        name: 'referenceText',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('notes', 'referenceText');
  }
}
