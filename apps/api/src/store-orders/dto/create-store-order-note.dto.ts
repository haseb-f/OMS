import { IsNotEmpty, IsString } from 'class-validator';

/** There is no dedicated StoreOrderNote table (unlike the legacy SalesOrder) — a note is simply an activity entry, since StoreOrderActivity is the one append-only timeline this model has. */
export class CreateStoreOrderNoteDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}
