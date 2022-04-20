// Copyright 2021 Parallel Finance Developer.
// This file is part of Parallel Finance.

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#![cfg_attr(not(feature = "std"), no_std)]
use crate::*;

impl<T: Config> pallet_traits::MoneyMarket<T::AccountId, AssetIdOf<T>, BalanceOf<T>> for Pallet<T> {
    fn stream_borrow(
        asset_id: AssetIdOf<T>,
        borrower: T::AccountId,
        borrow_amount: BalanceOf<T>,
    ) -> Result<(), DispatchError> {
        Self::ensure_active_market(asset_id)?;
        Self::ensure_enough_cash(asset_id, borrow_amount)?;

        Self::accrue_interest(asset_id)?;

        let account_borrows = Self::current_stream_borrow_balance(&borrower, asset_id)?;
        let account_borrows_new = account_borrows
            .checked_add(borrow_amount)
            .ok_or(ArithmeticError::Overflow)?;
        let total_borrows = Self::total_borrows(asset_id);
        let total_borrows_new = total_borrows
            .checked_add(borrow_amount)
            .ok_or(ArithmeticError::Overflow)?;
        let stream_total_borrows = Self::stream_total_borrows(asset_id);
        let stream_total_borrows_new = stream_total_borrows
            .checked_add(borrow_amount)
            .ok_or(ArithmeticError::Overflow)?;
        StreamAccountBorrows::<T>::insert(
            asset_id,
            &borrower,
            BorrowSnapshot {
                principal: account_borrows_new,
                borrow_index: Self::borrow_index(asset_id),
            },
        );
        TotalBorrows::<T>::insert(asset_id, total_borrows_new);
        StreamTotalBorrows::<T>::insert(asset_id, stream_total_borrows_new);
        T::Assets::transfer(
            asset_id,
            &Self::account_id(),
            &borrower,
            borrow_amount,
            false,
        )?;

        Self::deposit_event(Event::<T>::StreamBorrowed(
            borrower,
            asset_id,
            borrow_amount,
        ));

        Ok(())
    }

    fn stream_repay(
        asset_id: AssetIdOf<T>,
        borrower: T::AccountId,
        repay_amount: BalanceOf<T>,
    ) -> Result<(BalanceOf<T>, BalanceOf<T>), DispatchError> {
        Self::ensure_active_market(asset_id)?;
        Self::accrue_interest(asset_id)?;

        let account_borrows = Self::current_stream_borrow_balance(&borrower, asset_id)?;
        let mut real_repay_amount = repay_amount;
        if repay_amount > account_borrows {
            real_repay_amount = account_borrows;
        }
        T::Assets::transfer(
            asset_id,
            &borrower,
            &Self::account_id(),
            real_repay_amount,
            false,
        )?;
        let account_borrows_new = account_borrows
            .checked_sub(real_repay_amount)
            .ok_or(ArithmeticError::Underflow)?;
        let total_borrows = Self::total_borrows(asset_id);
        let total_borrows_new = total_borrows.saturating_sub(real_repay_amount);
        let stream_total_borrows = Self::stream_total_borrows(asset_id);
        let stream_total_borrows_new = stream_total_borrows.saturating_sub(real_repay_amount);
        AccountBorrows::<T>::insert(
            asset_id,
            &borrower,
            BorrowSnapshot {
                principal: account_borrows_new,
                borrow_index: Self::borrow_index(asset_id),
            },
        );
        TotalBorrows::<T>::insert(asset_id, total_borrows_new);
        StreamTotalBorrows::<T>::insert(asset_id, stream_total_borrows_new);

        Self::deposit_event(Event::<T>::RepaidStreamBorrow(
            borrower,
            asset_id,
            real_repay_amount,
        ));

        Ok((real_repay_amount, stream_total_borrows_new))
    }
}

impl<T: Config> Pallet<T> {}
