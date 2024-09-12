CREATE TABLE IF NOT EXISTS `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `instrument_id` varchar(128) DEFAULT NULL,
  `order_id` varchar(255) NOT NULL,
  `test_id` varchar(255) DEFAULT NULL,
  `test_type` varchar(255) NOT NULL,
  `created_date` date DEFAULT NULL,
  `test_unit` varchar(255) DEFAULT NULL,
  `results` varchar(255) DEFAULT NULL,
  `tested_by` varchar(255) DEFAULT NULL,
  `analysed_date_time` datetime DEFAULT NULL,
  `specimen_date_time` datetime DEFAULT NULL,
  `authorised_date_time` datetime DEFAULT NULL,
  `result_accepted_date_time` datetime DEFAULT NULL,
  `machine_used` varchar(40) DEFAULT NULL,
  `test_location` varchar(40) DEFAULT NULL,
  `created_at` int(11) NOT NULL DEFAULT '0',
  `result_status` int(11) NOT NULL DEFAULT '0',
  `lims_sync_status` int(11) DEFAULT '0',
  `lims_sync_date_time` datetime DEFAULT NULL,
  `repeated` int(11) DEFAULT '0',
  `test_description` varchar(40) DEFAULT NULL,
  `is_printed` int(11) DEFAULT NULL,
  `printed_at` int(11) DEFAULT NULL,
  `raw_text` mediumtext,
  `added_on` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `app_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `log` text NOT NULL,
  `added_on` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `raw_data` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `data` mediumtext NOT NULL,
  `machine` varchar(500) NOT NULL,
  `added_on` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

