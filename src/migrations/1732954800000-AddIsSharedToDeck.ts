import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIsSharedToDeck1732954800000 implements MigrationInterface {
  name = 'AddIsSharedToDeck1732954800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'decks',
      new TableColumn({
        name: 'isShared',
        type: 'boolean',
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('decks', 'isShared');
  }
}
