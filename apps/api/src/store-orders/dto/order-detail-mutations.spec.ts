import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateStoreOrderNoteDto,
  resolveStoreOrderNoteText,
} from './create-store-order-note.dto';
import {
  AddShipmentNotesDto,
  resolveShipmentNotes,
} from '../shipments/dto/add-shipment-notes.dto';
import { AddShippingCostDto } from '../shipments/dto/add-shipping-cost.dto';
import { CreatePaymentNoteDto } from '../../payments/dto/create-payment-note.dto';
import { CreatePaymentAttachmentDto } from '../../payments/dto/create-payment-attachment.dto';

async function errorsOf(cls: new () => object, payload: object) {
  const dto = plainToInstance(cls, payload);
  return validate(dto);
}

describe('order-detail mutation DTOs', () => {
  it('rejects empty and whitespace notes', async () => {
    expect(
      (await errorsOf(CreateStoreOrderNoteDto, { text: '' })).length,
    ).toBeGreaterThan(0);
    expect(
      (await errorsOf(CreateStoreOrderNoteDto, { note: '   ' })).length,
    ).toBeGreaterThan(0);
  });

  it('accepts legacy `note` and canonical `text` after trim', async () => {
    const fromLegacy = plainToInstance(CreateStoreOrderNoteDto, {
      note: '  hello  ',
    });
    const fromCanonical = plainToInstance(CreateStoreOrderNoteDto, {
      text: '  hello  ',
    });
    expect(resolveStoreOrderNoteText(fromLegacy)).toBe('hello');
    expect(resolveStoreOrderNoteText(fromCanonical)).toBe('hello');
    expect(await validate(fromLegacy)).toHaveLength(0);
    expect(await validate(fromCanonical)).toHaveLength(0);
  });

  it('accepts shipment notes from `note` or `notes`', async () => {
    const dto = plainToInstance(AddShipmentNotesDto, { note: ' packed ' });
    expect(resolveShipmentNotes(dto)).toBe('packed');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('maps shippingCost onto baseShippingCost and allows omitted payer', async () => {
    const dto = plainToInstance(AddShippingCostDto, { shippingCost: 12.5 });
    expect(dto.shippingCost).toBe(12.5);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a payment note without client-supplied userId', async () => {
    const dto = plainToInstance(CreatePaymentNoteDto, { text: 'paid in cash' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a payment attachment without uploadedById/attachmentType', async () => {
    const dto = plainToInstance(CreatePaymentAttachmentDto, {
      fileUrl: 'https://example.com/r.pdf',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
